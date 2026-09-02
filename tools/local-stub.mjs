/*
 * Build dist/_local.html — the real app with an in-memory stand-in for the
 * artifact `db` capability injected ahead of it.
 *
 * The published page gets its store from the claude.ai runtime, which doesn't
 * exist on localhost, so without this the picks/scores/standings screens can
 * never be exercised before publishing. This file is a test harness only; it is
 * never published and dist/_local.html is gitignored.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(root, "dist/index.html"), "utf8");

const STUB = `<script>
/* ---- in-memory stand-in for the artifact db capability (local testing only) ---- */
(function () {
  var store = {};                 // path -> body
  var subs = [];
  function snapOf(path) {
    var v = store[path];
    return { id: path.split("/").pop(), exists: v !== undefined,
             data: function () { return v; },
             metadata: { fromCache: false, hasPendingWrites: false } };
  }
  function fire() {
    subs.forEach(function (s) {
      if (s.kind === "doc") s.next(snapOf(s.path));
      else {
        var docs = Object.keys(store)
          .filter(function (p) { return p.indexOf(s.path + "/") === 0
            && p.slice(s.path.length + 1).indexOf("/") === -1; })
          .sort().map(snapOf);
        s.next({ docs: docs, size: docs.length, empty: !docs.length,
                 docChanges: function () { return []; },
                 metadata: { fromCache: false, hasPendingWrites: false } });
      }
    });
  }
  function deepMerge(a, b) {
    var out = Object.assign({}, a);
    Object.keys(b).forEach(function (k) {
      if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) &&
          out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) {
        out[k] = deepMerge(out[k], b[k]);
      } else out[k] = b[k];
    });
    return out;
  }
  function docRef(path) {
    return {
      id: path.split("/").pop(), path: path,
      get: function () { return Promise.resolve(snapOf(path)); },
      set: function (d) { store[path] = JSON.parse(JSON.stringify(d)); fire();
        return Promise.resolve(); },
      update: function (d) {
        if (store[path] === undefined) return Promise.reject({ code: "invalid_argument" });
        store[path] = deepMerge(store[path], JSON.parse(JSON.stringify(d))); fire();
        return Promise.resolve();
      },
      delete: function () { delete store[path]; fire(); return Promise.resolve(); },
      onSnapshot: function (next) {
        var s = { kind: "doc", path: path, next: next }; subs.push(s);
        setTimeout(function () { next(snapOf(path)); }, 0);
        return function () { subs.splice(subs.indexOf(s), 1); };
      },
      collection: function (p) { return colRef(path + "/" + p); }
    };
  }
  function colRef(path) {
    return {
      path: path,
      doc: function (id) { return docRef(path + "/" + (id || "auto" + Math.random().toString(36).slice(2))); },
      add: function (d) { var r = this.doc(); return r.set(d).then(function () { return r; }); },
      where: function () { return this; }, orderBy: function () { return this; },
      limit: function () { return this; },
      get: function () { return Promise.resolve({ docs: [], size: 0, empty: true,
        docChanges: function () { return []; }, metadata: {} }); },
      onSnapshot: function (next) {
        var s = { kind: "col", path: path, next: next }; subs.push(s);
        setTimeout(fire, 0);
        return function () { subs.splice(subs.indexOf(s), 1); };
      }
    };
  }
  window.__stubStore = store;
  window.claude = { use: function (n) {
    return Promise.resolve(n === "db" ? { doc: docRef, collection: colRef } : null);
  } };
})();
</script>
`;

writeFileSync(join(root, "dist/_local.html"), STUB + app);
console.log("dist/_local.html written (test harness, not published)");
