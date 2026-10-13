// Mantine Anchor as a type-checked router link: <AnchorLink to="/archive" search={{ q }}>.
// `<Anchor component={Link}>` loses the router's types for params and search.

import { Anchor, type AnchorProps } from "@mantine/core";
import { createLink } from "@tanstack/react-router";
import { forwardRef, type AnchorHTMLAttributes } from "react";

const MantineAnchor = forwardRef<HTMLAnchorElement, AnchorProps & AnchorHTMLAttributes<HTMLAnchorElement>>((props, ref) => (
  <Anchor ref={ref} {...props} />
));
MantineAnchor.displayName = "MantineAnchor";

export const AnchorLink = createLink(MantineAnchor);
