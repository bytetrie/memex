# General web app system

Status: implemented (2026-10-03). See AGENTS.md for the resulting setup.

This will be a web app based around modern tooling and best practices.

We will use TypeScript, zod, hono, and react.

UI system with agent tools: https://mantine.dev/
Build icons as font from: https://github.com/fontello/fontello#developers-api
Use the font in ./font/texgyre
- Install and use woff2_compress to convert

We will have a left thing sidebar (icon menu with tooltip name) to switch
between different app components.
- for now, just create dummy pages and items for:
  - archive
  - notes
  - chat
  - memex
  - external

Ensure a document is created to guide agents to understanding the setup such
that they can build out extra parts using the correct process and tools.