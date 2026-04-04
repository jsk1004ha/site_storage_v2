const test = require("node:test");
const assert = require("node:assert/strict");

const { loadAppExports } = require("./helpers/load-app-exports");

const {
  extractDomain,
  mergeData,
  normalizeData
} = loadAppExports();

function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("normalizeData keeps the newest bookmark version and preserves sanitized bookmark fields", () => {
  const normalized = toPlain(normalizeData({
    updatedAt: 600,
    bookmarks: [
      {
        id: "alpha",
        url: "https://www.example.com/article",
        name: "Older title",
        folder: "읽기\\나중에",
        tags: ["design", "design", "ui"],
        thumbUrl: "/thumb.png",
        faviconUrl: "javascript:alert(1)",
        updatedAt: 200,
        createdAt: 100
      },
      {
        id: "alpha",
        url: "https://www.example.com/article",
        name: "Newest title",
        folder: "읽기\\나중에",
        tags: ["design", "ux"],
        thumbUrl: "/thumb.png",
        faviconUrl: "/favicon.ico",
        updatedAt: 500,
        createdAt: 100,
        reader: {
          title: "Article",
          blocks: ["  첫 문단  ", "", "둘째 문단"],
          images: ["/hero.png", "ftp://invalid.example/image.png"]
        }
      },
      {
        id: "invalid",
        url: "chrome://settings",
        name: "Should be dropped",
        updatedAt: 300
      }
    ],
    tombstones: [
      { id: "beta", deletedAt: 400 },
      { id: "beta", deletedAt: 350 }
    ]
  }));

  assert.equal(normalized.version, 2);
  assert.equal(normalized.bookmarks.length, 1);
  assert.equal(normalized.tombstones.length, 1);

  const [bookmark] = normalized.bookmarks;
  assert.equal(bookmark.id, "alpha");
  assert.equal(bookmark.name, "Newest title");
  assert.equal(bookmark.domain, "example.com");
  assert.equal(bookmark.folder, "읽기/나중에");
  assert.deepEqual(bookmark.tags, ["design", "ux"]);
  assert.equal(bookmark.thumbUrl, "https://www.example.com/thumb.png");
  assert.equal(bookmark.faviconUrl, "https://www.example.com/favicon.ico");
  assert.deepEqual(bookmark.reader.blocks, ["첫 문단", "둘째 문단"]);
  assert.deepEqual(bookmark.reader.images, ["https://www.example.com/hero.png"]);
  assert.equal(normalized.tombstones[0].deletedAt, 400);
});

test("normalizeData removes bookmarks shadowed by newer tombstones", () => {
  const normalized = toPlain(normalizeData({
    bookmarks: [
      {
        id: "gone",
        url: "https://example.com/gone",
        updatedAt: 100
      }
    ],
    tombstones: [{ id: "gone", deletedAt: 120 }]
  }));

  assert.deepEqual(normalized.bookmarks, []);
  assert.deepEqual(normalized.tombstones, [{ id: "gone", deletedAt: 120 }]);
});

test("mergeData favors the newest bookmark or tombstone per id", () => {
  const merged = toPlain(mergeData(
    {
      updatedAt: 800,
      bookmarks: [
        {
          id: "keep-local",
          url: "https://example.com/local",
          name: "Local wins",
          updatedAt: 700
        },
        {
          id: "delete-me",
          url: "https://example.com/delete-me",
          name: "Old bookmark",
          updatedAt: 100
        }
      ],
      tombstones: [{ id: "stale-delete", deletedAt: 200 }]
    },
    {
      updatedAt: 900,
      bookmarks: [
        {
          id: "remote-newer",
          url: "https://example.com/remote",
          name: "Remote wins",
          updatedAt: 850
        },
        {
          id: "stale-delete",
          url: "https://example.com/restored",
          name: "Restored after delete",
          updatedAt: 500
        }
      ],
      tombstones: [
        { id: "delete-me", deletedAt: 600 },
        { id: "remote-only-delete", deletedAt: 750 }
      ]
    }
  ));

  assert.equal(merged.updatedAt, 900);
  assert.deepEqual(
    merged.bookmarks.map((item) => item.id).sort(),
    ["keep-local", "remote-newer", "stale-delete"]
  );
  assert.deepEqual(
    merged.tombstones.map((item) => item.id),
    ["remote-only-delete", "delete-me"]
  );
});

test("extractDomain strips www and rejects invalid urls", () => {
  assert.equal(extractDomain("https://www.remember.example/path"), "remember.example");
  assert.equal(extractDomain("notaurl"), "");
});
