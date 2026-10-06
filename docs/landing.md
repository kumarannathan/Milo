# Landing page

The marketing site lives in `site/` (plain HTML, CSS and JS; it imports `src/styles/tokens.css`). Run `npm run dev:site` to work on it at http://localhost:5180, and `npm run build:site` to write a static build to `dist-site/`.

`dist-site/` uses relative asset paths, so it can be served from any host or subpath: publish the folder with GitHub Pages (for example via `actions/upload-pages-artifact` with `path: dist-site`) or Netlify (build command `npm run build:site`, publish directory `dist-site`).
