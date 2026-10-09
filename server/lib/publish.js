// Publishing an approved icon: getting its centerline file to where the build
// picks it up, at raw-svgs/<name>/<name>.centerline.svg.
//
// That path is the package's source of truth. `npm run build:icons` turns it
// into src/icons/<Component>.tsx and adds the export, and `prepublishOnly` runs
// the same build, so a file committed here ships with the next release.
//
// Two strategies, because "write the file" means different things per
// environment:
//
//   local   the working tree is writable (a developer running `npm run dev`),
//           so the file is written straight into raw-svgs/. Immediate, and the
//           next build includes it.
//   github  a deployed function cannot persist a file — the filesystem is
//           read-only apart from /tmp and is rebuilt on every deploy — so the
//           file is committed to the repo over the GitHub API instead.
//
// Approval is the only gate. Neither strategy opens a pull request: the admin
// has already reviewed the icon, and a second merge step would strand approved
// icons in a queue.
//
// Neither runs `build:icons`: it optimizes 9k SVGs and rewrites src/, which is
// far too much to do inside a request. Committing the source file is the durable
// step; the build happens on the next deploy or release.
import { mkdir, writeFile, access, rm, rmdir, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toCenterlineSvg } from "./validate.js";
import { SOURCE_WEIGHTS } from "./icons.js";
import "./env.js";

// server/lib -> server -> repo root
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Repo-relative path of an icon's source file. */
function iconFilePath(name) {
  return `raw-svgs/${name}/${name}.centerline.svg`;
}

async function treeIsWritable() {
  try {
    await access(join(ROOT, "raw-svgs"), constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

const WEIGHT_FILE_RE = new RegExp(`-(${SOURCE_WEIGHTS.join("|")})\\.svg$`);

/**
 * True when raw-svgs/<name>/ holds a hand-drawn six-weight set.
 *
 * Those directories are the package's built artwork. A contribution that happens
 * to share a name must neither write into one — the build reads a centerline
 * file in preference to the weight files, so it would replace the shipped icon —
 * nor delete one. The submission API rejects such a name up front; this is the
 * check at the point where files are actually touched.
 */
async function holdsBuiltArtwork(name) {
  try {
    const entries = await readdir(join(ROOT, "raw-svgs", name));
    return entries.some((file) => WEIGHT_FILE_RE.test(file));
  } catch {
    return false; // no such directory, so nothing built under this name
  }
}

/** Write the icon into the local working tree. */
async function publishLocal(name, paths) {
  const rel = iconFilePath(name);
  if (await holdsBuiltArtwork(name)) {
    throw new Error(`raw-svgs/${name}/ holds a built icon; refusing to write over it.`);
  }
  const abs = join(ROOT, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, toCenterlineSvg(paths), "utf8");
  return {
    mode: "local",
    filePath: rel,
    url: null,
    detail: "Written to the working tree. Run `npm run build:icons` to generate the component.",
  };
}

// --- GitHub -----------------------------------------------------------------

async function gh(method, apiPath, body) {
  const res = await fetch(`https://api.github.com${apiPath}`, {
    method,
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      accept: "application/vnd.github+json",
      "user-agent": "icon-genie-admin",
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // The status rides on the error rather than only in its text, so a caller can
    // tell "no such file" from a fault without reading the message for digits an
    // icon name could just as well supply.
    const err = new Error(`GitHub ${method} ${apiPath} -> ${res.status}: ${data.message || "error"}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/**
 * Commit the icon straight onto the base branch. There is no pull request step:
 * the admin's approval IS the review, so requiring a second merge would leave
 * approved icons sitting in a queue nobody is watching.
 *
 * The tradeoff is explicit — nobody reviews the diff, only the drawing. It is
 * contained by what this can write: one generated file, at a path derived from a
 * kebab-cased name, holding path data the server already validated.
 */
async function publishToGitHub(name, paths, contributor) {
  const repo = process.env.GH_REPO || "shashi-hans/genie-icons";
  const base = process.env.GH_BASE || "main";
  const rel = iconFilePath(name);
  const content = Buffer.from(toCenterlineSvg(paths), "utf8").toString("base64");
  const credit = contributor && contributor !== "Anonymous" ? contributor : "an anonymous contributor";

  await gh("PUT", `/repos/${repo}/contents/${encodeURI(rel)}`, {
    message:
      `feat(icons): add ${name}\n\n` +
      `Community-contributed icon, approved in the review queue.\n` +
      `Contributed by ${credit}.`,
    content,
    branch: base,
  });

  return {
    mode: "github-commit",
    filePath: rel,
    url: `https://github.com/${repo}/blob/${base}/${rel}`,
    detail: `Committed to ${base}. It ships with the next build.`,
  };
}

/**
 * Remove the icon's source file from the local working tree.
 *
 * Only that one file: the directory may hold a built six-weight set, and
 * deleting the directory would take the shipped artwork with it.
 */
async function unpublishLocal(name) {
  const rel = iconFilePath(name);
  const abs = join(ROOT, rel);
  if (await holdsBuiltArtwork(name)) {
    return {
      mode: "none",
      filePath: rel,
      url: null,
      detail: `raw-svgs/${name}/ holds a built icon; its files were left in place.`,
    };
  }
  await rm(abs, { force: true });
  // The directory existed only to hold that file, so take it too — but with
  // rmdir, which refuses a directory that still has something in it.
  await rmdir(dirname(abs)).catch(() => {});
  return {
    mode: "local",
    filePath: rel,
    url: null,
    detail: "Source file removed. Run `npm run build:icons` to drop the component.",
  };
}

/** Delete the icon's source file from the repo. Requires its current blob sha. */
async function unpublishFromGitHub(name) {
  const repo = process.env.GH_REPO || "shashi-hans/genie-icons";
  const base = process.env.GH_BASE || "main";
  const rel = iconFilePath(name);
  const current = await gh("GET", `/repos/${repo}/contents/${encodeURI(rel)}?ref=${encodeURIComponent(base)}`);
  await gh("DELETE", `/repos/${repo}/contents/${encodeURI(rel)}`, {
    message: `feat(icons): remove ${name}\n\nRemoved from the gallery by an admin.`,
    sha: current.sha,
    branch: base,
  });
  return {
    mode: "github-commit",
    filePath: rel,
    url: null,
    detail: `Removed from ${base}. It leaves the package on the next build.`,
  };
}

/**
 * Undo publishing: take the icon's source file back out, mirroring publishIcon.
 * Like it, never throws — the record is already gone by the time this runs, so a
 * failure here needs reporting rather than a half-rolled-back delete.
 */
export async function unpublishIcon({ name }) {
  try {
    if (await treeIsWritable()) return await unpublishLocal(name);
    if (process.env.GITHUB_TOKEN) return await unpublishFromGitHub(name);
    return {
      mode: "none",
      filePath: iconFilePath(name),
      url: null,
      detail: "Removed from the gallery. The source file, if any, was left in place.",
    };
  } catch (err) {
    // A 404 means there was nothing published, which is a normal outcome for an
    // icon deleted before it was ever approved.
    const missing = err.status === 404;
    return {
      mode: missing ? "none" : "failed",
      filePath: iconFilePath(name),
      url: null,
      detail: missing
        ? "Removed from the gallery. No published source file to remove."
        : `Removed from the gallery, but the source file could not be deleted: ${err.message}`,
      error: missing ? undefined : err.message,
    };
  }
}

/* --- Removing artwork from the package -------------------------------------
 *
 * unpublishIcon above takes back one approved contribution and refuses to touch
 * a directory holding a built six-weight set. This is the other thing: deleting
 * artwork the package ships, which is how a near-duplicate actually leaves the
 * npm package rather than only the gallery.
 *
 * It is permanent in a way hiding is not. A project that already imports the
 * component gets a build error on the next release, so the admin page asks for
 * confirmation and names what it is about to remove.
 *
 * Batched on purpose. One press removing one icon would mean one commit to the
 * default branch per press, and on a deployed site one rebuild per press. A
 * selection goes as a single commit.
 */

/** Remove whole icon directories from the local working tree. */
async function removeLocal(names) {
  const root = join(ROOT, "raw-svgs");
  const removed = [];
  for (const name of names) {
    const dir = resolve(root, name);
    // This deletes a directory tree, so it checks rather than trusts that the
    // path it was handed is inside raw-svgs/. The API filters names before they
    // reach here; a script calling this directly does not.
    if (dir !== join(root, name) || !dir.startsWith(root + "/")) continue;
    // Reported only when there was something to delete. rm with force treats a
    // missing directory as success, so counting every name meant answering "21
    // removed" for a list of names that were already gone.
    try {
      await access(dir, constants.F_OK);
    } catch {
      continue;
    }
    await rm(dir, { recursive: true, force: true });
    removed.push(name);
  }
  return {
    mode: "local",
    removed,
    url: null,
    detail:
      `${removed.length} ${removed.length === 1 ? "directory" : "directories"} removed from raw-svgs/. ` +
      "Run `npm run build:icons` to drop the components.",
  };
}

/**
 * Remove the same directories from the repo, as one commit.
 *
 * Through the Git data API rather than the contents API: that one deletes a
 * single file per call and makes a commit each time, which for a selection of
 * forty icons is forty commits and forty rebuilds.
 */
async function removeFromGitHub(names) {
  const repo = process.env.GH_REPO || "shashi-hans/genie-icons";
  const base = process.env.GH_BASE || "main";

  const ref = await gh("GET", `/repos/${repo}/git/ref/heads/${encodeURIComponent(base)}`);
  const head = ref.object.sha;
  const commit = await gh("GET", `/repos/${repo}/git/commits/${head}`);

  // Every file under each directory, because a tree entry is a file: there is no
  // "delete this folder" in the git data API.
  const tree = await gh("GET", `/repos/${repo}/git/trees/${commit.tree.sha}?recursive=1`);
  // GitHub drops entries rather than erroring once a tree is large enough, and a
  // silently short list here would commit a partial removal that looks complete.
  if (tree.truncated) {
    throw new Error("The repository tree came back truncated; nothing was removed.");
  }

  // Matched by the directory name parsed out of each path, so this is one Set
  // lookup per entry. Testing every wanted prefix against every path was the
  // number of icons times the number of files in the repo — tens of millions of
  // comparisons for one press.
  const wanted = new Set(names);
  const hit = new Set();
  const deletions = [];
  for (const entry of tree.tree) {
    if (entry.type !== "blob") continue;
    const dir = entry.path.startsWith("raw-svgs/") ? entry.path.split("/")[1] : null;
    if (!dir || !wanted.has(dir)) continue;
    hit.add(dir);
    deletions.push({ path: entry.path, mode: entry.mode, type: "blob", sha: null });
  }

  if (!deletions.length) {
    return { mode: "none", removed: [], url: null, detail: "Nothing to remove: no such files in the repository." };
  }

  // The names go in the body so the commit records what left and why, but a
  // selection of several hundred would make a message nothing can read.
  const removed = [...hit];
  const listed = removed.slice(0, 50);
  const body =
    `Removed from the catalogue by an admin:\n${listed.map((n) => `- ${n}`).join("\n")}` +
    (removed.length > listed.length ? `\n- and ${removed.length - listed.length} more` : "");

  const newTree = await gh("POST", `/repos/${repo}/git/trees`, {
    base_tree: commit.tree.sha,
    tree: deletions,
  });
  const made = await gh("POST", `/repos/${repo}/git/commits`, {
    message: `feat(icons): remove ${removed.length} ${removed.length === 1 ? "icon" : "icons"}\n\n${body}`,
    tree: newTree.sha,
    parents: [head],
  });
  await gh("PATCH", `/repos/${repo}/git/refs/heads/${encodeURIComponent(base)}`, { sha: made.sha });

  return {
    mode: "github-commit",
    // What the tree actually held, not what was asked for: a name with no files
    // in the repository was not removed by this.
    removed,
    url: `https://github.com/${repo}/commit/${made.sha}`,
    detail: `${deletions.length} files removed from ${base} in one commit. They leave the package on the next build.`,
  };
}

/**
 * Delete the artwork for `names` wherever this process can actually write.
 *
 * Never throws, like the two above: the caller reports the outcome, and a
 * failure here must not look like a half-done delete.
 */
export async function removeIconArtwork(names) {
  try {
    if (!names.length) return { mode: "none", removed: [], url: null, detail: "Nothing selected." };
    if (await treeIsWritable()) return await removeLocal(names);
    if (process.env.GITHUB_TOKEN) return await removeFromGitHub(names);
    return {
      mode: "none",
      removed: [],
      url: null,
      detail:
        "Nothing was removed: the working tree is read-only and GITHUB_TOKEN is unset. " +
        "The icons are out of the gallery, and their files are still in raw-svgs/.",
      error: "no writable target",
    };
  } catch (err) {
    return {
      mode: "failed",
      removed: [],
      url: null,
      detail: `The icons are out of the gallery, but their files could not be removed: ${err.message}`,
      error: err.message,
    };
  }
}

/**
 * Publish an approved icon, choosing the strategy that can actually persist.
 *
 * Never throws: a publishing failure must not undo an approval the admin already
 * made, so the outcome is returned either way and the caller reports it.
 */
export async function publishIcon({ name, paths, contributor }) {
  try {
    if (await treeIsWritable()) return await publishLocal(name, paths);
    if (process.env.GITHUB_TOKEN) return await publishToGitHub(name, paths, contributor);
    return {
      mode: "none",
      filePath: iconFilePath(name),
      url: null,
      detail:
        "Not written anywhere: the working tree is read-only and GITHUB_TOKEN is unset. " +
        "The icon is live in the gallery; download its source to add it to the package by hand.",
      error: "no writable target",
    };
  } catch (err) {
    return {
      mode: "failed",
      filePath: iconFilePath(name),
      url: null,
      detail: `Approved, but publishing failed: ${err.message}`,
      error: err.message,
    };
  }
}
