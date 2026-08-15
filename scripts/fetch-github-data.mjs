import { writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const GITHUB_USER = "tungbq";
const API_BASE = process.env.GITHUB_API_BASE ?? "https://api.github.com";
const OUTPUT_PATH = new URL("../data/github.json", import.meta.url);

// Distinguishes "our curated list references a repo GitHub no longer has"
// (a content bug -- always fails the build, cache or not) from a transient
// API/network failure (which degrades to the committed cache, see main()).
export class MissingCuratedRepoError extends Error {}

function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const [, url, rel] = part.match(/<([^>]+)>;\s*rel="([^"]+)"/) ?? [];
    if (rel === "next") return url;
  }
  return null;
}

// Extracts total contributor count from the Link header of a `?per_page=1`
// contributors request, without paginating through every contributor.
// Falls back to the first page's length when there's no Link header (0 or 1
// contributor total).
export function parseContributorCount(linkHeader, firstPageLength) {
  if (!linkHeader) return firstPageLength;
  for (const part of linkHeader.split(",")) {
    const match = part.match(/[?&]page=(\d+)>;\s*rel="last"/);
    if (match) return Number(match[1]);
  }
  return firstPageLength;
}

export async function fetchAll(url, token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `token ${token}`;

  const results = [];
  let next = url;
  while (next) {
    const res = await fetch(next, { headers });
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (!res.ok) {
      throw new Error(
        `GitHub API request failed: ${res.status} ${res.statusText} (${next}), x-ratelimit-remaining=${remaining}`
      );
    }
    console.warn(`fetched ${next} (x-ratelimit-remaining=${remaining})`);
    const body = await res.json();
    if (Array.isArray(body)) results.push(...body);
    else return body; // single-object endpoint (profile)
    next = parseNextLink(res.headers.get("link"));
  }
  return results;
}

export function trimRepo(raw) {
  return {
    name: raw.name,
    description: raw.description ?? null,
    stars: raw.stargazers_count ?? 0,
    forks: raw.forks_count ?? 0,
    language: raw.language ?? null,
    topics: raw.topics ?? [],
    htmlUrl: raw.html_url,
    pushedAt: raw.pushed_at,
    archived: raw.archived ?? false,
  };
}

// Contributor count isn't in the single-repo API response trimRepo() reads,
// so it's a separate per-repo call, kept out of trimRepo() to keep that
// function pure/sync and its exact-shape test stable.
export async function fetchContributorCount(owner, repo, token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `token ${token}`;
  try {
    const res = await fetch(
      `${API_BASE}/repos/${owner}/${repo}/contributors?per_page=1&anon=true`,
      { headers }
    );
    if (!res.ok) return null; // degrade gracefully -- don't fail the whole build
    const body = await res.json();
    return parseContributorCount(
      res.headers.get("link"),
      Array.isArray(body) ? body.length : 0
    );
  } catch {
    // Network/parse failure on one repo's contributor call must not revert
    // the whole build's freshly-fetched data to stale cache -- degrade to null.
    return null;
  }
}

export function buildData(profileRaw, reposRaw, curated) {
  const nonForkRepos = reposRaw.filter((r) => !r.fork);
  const trimmed = nonForkRepos.map(trimRepo);
  const byLowerName = new Map(trimmed.map((r) => [r.name.toLowerCase(), r]));

  const repos = {};
  const missing = [];
  for (const project of curated) {
    const stats = byLowerName.get(project.repo.toLowerCase());
    if (!stats) {
      missing.push(project.repo);
      continue;
    }
    repos[project.repo] = stats;
  }
  if (missing.length > 0) {
    throw new MissingCuratedRepoError(
      `Curated repos not found on GitHub: ${missing.join(", ")}`
    );
  }

  const totalStars = nonForkRepos.reduce(
    (sum, r) => sum + (r.stargazers_count ?? 0),
    0
  );

  const sortedRepos = Object.fromEntries(
    Object.keys(repos)
      .sort()
      .map((key) => [key, repos[key]])
  );

  return {
    generatedAt: new Date().toISOString().slice(0, 10),
    profile: {
      login: profileRaw.login,
      name: profileRaw.name ?? null,
      avatarUrl: profileRaw.avatar_url,
      followers: profileRaw.followers ?? 0,
      publicRepos: profileRaw.public_repos ?? 0,
      totalStars,
    },
    repos: sortedRepos,
  };
}

export async function main() {
  const token = process.env.GITHUB_TOKEN;
  const { projects: curated } = await import("../content/projects.ts");

  const profile = await fetchAll(`${API_BASE}/users/${GITHUB_USER}`, token);
  const repos = await fetchAll(
    `${API_BASE}/users/${GITHUB_USER}/repos?per_page=100&type=owner`,
    token
  );

  const data = buildData(profile, repos, curated);

  // Sequential, not Promise.all -- ~17 calls, avoids GitHub secondary
  // rate-limit bursts. Each curated repo is guaranteed present in data.repos
  // (buildData already threw MissingCuratedRepoError otherwise).
  for (const project of curated) {
    const stats = data.repos[project.repo];
    stats.contributors = await fetchContributorCount(GITHUB_USER, project.repo, token);
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2) + "\n");
  console.warn(`wrote ${OUTPUT_PATH.pathname} (${curated.length} curated repos)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    if (err instanceof MissingCuratedRepoError) {
      // A content bug (renamed/deleted repo in content/projects.ts), not a
      // transient API failure -- always fails the build, cache or not.
      process.exit(1);
    }
    if (existsSync(OUTPUT_PATH)) {
      console.warn("keeping existing data/github.json, deploy continues");
      process.exit(0);
    }
    process.exit(1);
  });
}
