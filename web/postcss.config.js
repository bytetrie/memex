// Mantine's recommended PostCSS setup, for *.module.css files in web/src:
// rem()/em() helpers, light-dark(), @mixin hover/smaller-than/larger-than, and
// $mantine-breakpoint-* variables. https://mantine.dev/styles/postcss-preset/
export default {
  plugins: {
    "postcss-preset-mantine": {},
    "postcss-simple-vars": {
      variables: {
        "mantine-breakpoint-xs": "36em",
        "mantine-breakpoint-sm": "48em",
        "mantine-breakpoint-md": "62em",
        "mantine-breakpoint-lg": "75em",
        "mantine-breakpoint-xl": "88em",
      },
    },
  },
};
