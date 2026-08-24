---
"r2-explorer": patch
---

Fix the email list's responsive styles never compiling

`EmailFolderPage.vue` declared its styles in a plain `<style>` block while
writing them in SCSS — nested rules, `&` parent selectors and `//` comments.
Vue hands such a block to the CSS parser untouched, so rather than failing the
build, esbuild warned six times and passed the text straight through into the
stylesheet:

```css
.email-sender{...;text-overflow:ellipsis;.mobile-subject {display: none;} @media (max-width: 992px) {width: 100%; ...
```

A browser with native CSS nesting still applies that, which is why the layout
looks correct on current Chrome, Safari and Firefox. Anything older — and the
build targets `chrome87`, `edge88`, `firefox78` and `safari13.1` — drops the
lot. On those browsers the email list never switched to its mobile layout
below 992px (the inline subject stayed hidden and the desktop columns stayed
visible), and rows had no hover shadow. A stray `//width: 100%;` was also
shipped verbatim as invalid CSS.

Adding `lang="scss"` compiles the rules properly:

```css
.email-sender .mobile-subject{display:none}
@media (max-width: 992px){.email-sender{width:100%;height:auto!important}...
.email-list td:not(.email-sender){display:none}
.email-list tbody tr:hover{box-shadow:0 2px 8px -2px #8d34f473;z-index:10}
```

The six CSS build warnings are gone, and a unit test now fails on any SFC
`<style>` block that uses SCSS syntax without declaring `lang="scss"`.
