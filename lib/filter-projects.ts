import type Fuse from "fuse.js";
import type { Project } from "@/types/github";

export const SORT_OPTIONS = ["default", "updated", "stars", "name"] as const;
export type SortBy = (typeof SORT_OPTIONS)[number];

// Topics that describe more curated projects are more useful as filters
// (narrow across several cards) than topics unique to one project. Sorted by
// frequency desc, then alphabetically for a stable tiebreak.
export function sortTopicsByFrequency(projects: Project[]): string[] {
  const counts = new Map<string, number>();
  for (const project of projects) {
    for (const topic of project.stats.topics) {
      counts.set(topic, (counts.get(topic) ?? 0) + 1);
    }
  }
  return Array.from(counts.keys()).sort((a, b) => {
    const diff = (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
    return diff !== 0 ? diff : a.localeCompare(b);
  });
}

export interface FilterProjectsArgs {
  projects: Project[];
  query: string;
  category: string;
  language: string;
  topics: string[];
  sortBy: SortBy;
  fuse: Fuse<Project>;
}

function sortProjects(projects: Project[], sortBy: SortBy): Project[] {
  switch (sortBy) {
    case "updated":
      return [...projects].sort(
        (a, b) => new Date(b.stats.pushedAt).getTime() - new Date(a.stats.pushedAt).getTime()
      );
    case "stars":
      return [...projects].sort((a, b) => b.stats.stars - a.stats.stars);
    case "name":
      return [...projects].sort((a, b) => a.title.localeCompare(b.title));
    case "default":
      return projects;
  }
}

export function filterProjects({
  projects,
  query,
  category,
  language,
  topics,
  sortBy,
  fuse,
}: FilterProjectsArgs): Project[] {
  const searched = query.trim()
    ? fuse.search(query.trim()).map((result) => result.item)
    : projects;

  const filtered = searched
    .filter((project) => category === "All" || project.category === category)
    .filter(
      (project) => language === "All" || project.stats.language === language
    )
    .filter(
      (project) =>
        topics.length === 0 ||
        project.stats.topics.some((topic) => topics.includes(topic))
    );

  return sortProjects(filtered, sortBy);
}
