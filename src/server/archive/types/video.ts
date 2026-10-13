// type "video": a URL fetched by the `ytdlp` runner and turned into HLS + images by the `encode`
// runner (ideas/videos.md). It is a job type: POST /archive/jobs queues it, the worker runs this.
// The entry keeps the HLS stream (a lossless remux of the download, which itself is not kept), the
// English transcript, the trimmed info JSON, a poster, a card thumbnail and an animated preview.

import { VideoInputSchema, isFetchableUrl } from "../../../shared/archive-types.ts";
import { ENCODED_FILES, EncodeDoneSchema, FetchDoneSchema } from "../../../shared/runners.ts";
import { transcriptCues } from "../../../shared/vtt.ts";
import type { NewFile } from "../ports.ts";
import { defineJobType } from "./define.ts";
import { InfoSchema, checkPlaylist, isoDate, looksLike, parseJsonObject, trimInfo } from "./video-info.ts";

export const MAX_HEIGHT = 1080;
export const SUB_LANG = "en";
const INFO_MAX_BYTES = 32 * 1024 ** 2;
const VTT_MAX_BYTES = 16 * 1024 ** 2;
const INDEXED_CHARS = 200_000;

export const videoType = defineJobType({
  label: "Video",
  input: VideoInputSchema,
  sourceUrl: ({ url }) => url,
  async run({ url }, ctx) {
    ctx.progress("download", null, "Starting");
    const fetched = await ctx.runner("ytdlp", { v: 1, op: "fetch", url, maxHeight: MAX_HEIGHT, subLang: SUB_LANG }, FetchDoneSchema);
    const dir = fetched.dir;

    const rawInfo = parseJsonObject(await ctx.readHead(dir, ENCODED_FILES.info, INFO_MAX_BYTES));
    const info = InfoSchema.parse(rawInfo);
    // The page's own URL (a short link and the full one are the same video).
    const sourceUrl = info.webpage_url && isFetchableUrl(info.webpage_url) ? info.webpage_url : url;
    const existing = await ctx.findEntryBySource(sourceUrl);
    if (existing) throw new Error(`this video is already archived: archive:${existing}`);

    const encoded = await ctx.runner("encode", { v: 1, op: "encode", dir, subLang: SUB_LANG }, EncodeDoneSchema);
    if (encoded.dir !== dir) throw new Error("the encode runner answered for another job folder");
    const has = new Set(encoded.files);

    ctx.progress("import", null, "Checking the files");
    const playlist = new TextDecoder("utf-8", { fatal: true }).decode(await ctx.readHead(dir, ENCODED_FILES.playlist, 1024 ** 2));
    if (!checkPlaylist(playlist, "media.mp4")) throw new Error("the HLS playlist is not what the encode runner should write");
    if (!looksLike.mp4(await ctx.readHead(dir, ENCODED_FILES.media, 16))) throw new Error("the HLS media file is not an MP4");
    const images: { kind: "poster" | "thumb" | "preview"; file: string; mime: string; ok: (head: Uint8Array) => boolean }[] = [
      { kind: "poster", file: ENCODED_FILES.poster, mime: "image/jpeg", ok: looksLike.jpeg },
      { kind: "thumb", file: ENCODED_FILES.thumb, mime: "image/jpeg", ok: looksLike.jpeg },
      { kind: "preview", file: ENCODED_FILES.preview, mime: "image/avif", ok: looksLike.avif },
    ];
    for (const image of images) {
      if (has.has(image.kind) && !image.ok(await ctx.readHead(dir, image.file, 16))) {
        ctx.log.warn({ file: image.file }, "image is not what its name says; leaving it out");
        has.delete(image.kind);
      }
    }
    let transcript = "";
    if (has.has("transcript")) {
      try {
        const vtt = new TextDecoder("utf-8", { fatal: true }).decode(await ctx.readHead(dir, ENCODED_FILES.transcript, VTT_MAX_BYTES));
        if (!vtt.replace(/^\uFEFF/, "").startsWith("WEBVTT")) throw new Error("not WebVTT");
        transcript = transcriptCues(vtt).map((c) => c.text).join("\n");
      } catch (err) {
        ctx.log.warn({ err }, "subtitles are not readable WebVTT; leaving them out");
        has.delete("transcript");
      }
    }

    ctx.progress("import", null, "Importing the video");
    const files: NewFile[] = [];
    // `file`: the runner's name for it; `name`: the entry's.
    const add = async (file: string, name: string, mime: string, role: NewFile["role"]) => {
      const { sha256 } = await ctx.importFile(dir, file);
      files.push({ sha256, name, mime, role });
    };
    await add(ENCODED_FILES.playlist, "hls/index.m3u8", "application/vnd.apple.mpegurl", "original");
    await add(ENCODED_FILES.media, "hls/media.mp4", "video/mp4", "original");
    if (has.has("transcript")) await add(ENCODED_FILES.transcript, `transcript.${SUB_LANG}.vtt`, "text/vtt", "derived");
    for (const image of images) {
      if (has.has(image.kind)) await add(image.file, image.file, image.mime, "thumbnail");
    }
    const infoBlob = await ctx.putBlob(new Blob([JSON.stringify(trimInfo(rawInfo), null, 2)]).stream());
    files.push({ sha256: infoBlob.sha256, name: "info.json", mime: "application/json", role: "metadata" });

    const manual = Object.keys(info.subtitles ?? {}).some((lang) => lang === SUB_LANG || lang.startsWith(`${SUB_LANG}-`));
    const meta: Record<string, unknown> = {
      extractor: info.extractor_key ?? null,
      videoId: info.id ?? null,
      channel: info.channel ?? info.uploader ?? null,
      uploadDate: info.upload_date ? isoDate(info.upload_date) : null,
      duration: encoded.probe.duration ?? info.duration ?? null,
      width: encoded.probe.width,
      height: encoded.probe.height,
      vcodec: encoded.probe.vcodec,
      acodec: encoded.probe.acodec,
      transcoded: encoded.probe.transcoded,
      subtitles: has.has("transcript") ? (manual ? "manual" : "automatic") : "none",
      ytDlpVersion: info._version?.version ?? null,
    };
    const title = (info.title ?? "").trim().slice(0, 300) || "Untitled video";
    return {
      title,
      sourceUrl,
      meta,
      searchText: [title, info.channel ?? "", info.description ?? "", transcript].join("\n").slice(0, INDEXED_CHARS),
      files,
    };
  },
});
