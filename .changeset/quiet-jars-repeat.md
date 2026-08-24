---
"r2-explorer": patch
---

Align the dashboard with the Cloudkid design system and add the Explorer compass logo

The dashboard shipped a mix of Quasar defaults on top of the dark Cloudkid theme — green
buttons, light-grey dialog headers, a white bucket picker and orange accents. Everything now
resolves from the design system's own tokens.

**Explorer logo.** A new compass mark (`public/explorer-logo.svg`) replaces the generic box
icon in the topbar, and the favicon set, `favicon.ico` and `logo.png` are regenerated from
it. It follows the Cloudkid badge grammar used by the webinar worker: dark squircle, a
purple→gold gradient ring, and a stroke needle with a filled north half so it stays readable
at 16px.

**Purple/gold gradient CTA.** The green `New` button, the green email `Refresh` button and
the green preview `Save` button now use a `.btn-cta` class carrying the design system's
`--gradient-cta` (`linear-gradient(to left, #a864f7, #f5c73d)`). The label is
`--accent-foreground` rather than a light colour, which a light label only reaches 1.9:1
contrast against the gold end of the ramp.

**Light surfaces on a dark app.** The file preview dialog header, the email detail toolbar,
the share-link result panel and read email rows were all rendering light-on-light or
black-on-dark. They now use the brand header/surface fills, and inline `<code>` chips get a
dark surface with a lilac foreground.

**Email bodies.** HTML mail is authored against a white background and rarely sets a text
colour, so message bodies rendered near-black on the dark theme. The message now gets its own
light canvas, the way mail clients do.

**Other defaults swept up.** The bucket picker no longer forces `bg-color="white"`, the 404
page drops Quasar's stock blue for the brand gradient, tooltips pick up a brand surface, and
folder/metadata/rename accents move from `orange` to the gold `accent` token.

`$primary` resolves to the design system's `--primary-muted` rather than `--primary`: Quasar
paints solid buttons with a white label, and the vivid violet only reaches 3.6:1 against
white.
