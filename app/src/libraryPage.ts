export interface CreateLibraryPageDeps { template: string; }

const REQUIRED_SLOTS = ['RECORDINGS_JSON'] as const;
const PLACEHOLDER_RE = /\{\{([A-Z_]+)\}\}/g;

export class LibraryTemplateInvalidError extends Error {
  readonly missing: readonly string[];
  readonly unknown: readonly string[];
  constructor({ missing, unknown }: { missing: readonly string[]; unknown: readonly string[] }) {
    super(`Library template placeholder mismatch — missing: [${missing.join(', ')}], unknown: [${unknown.join(', ')}]`);
    this.name = 'LibraryTemplateInvalidError';
    this.missing = missing;
    this.unknown = unknown;
  }
}

export function createLibraryPage(deps: CreateLibraryPageDeps) {
  const present = new Set<string>();
  for (const m of deps.template.matchAll(PLACEHOLDER_RE)) present.add(m[1]);
  const missing = REQUIRED_SLOTS.filter((s) => !present.has(s));
  const unknown = [...present].filter((s) => !(REQUIRED_SLOTS as readonly string[]).includes(s));
  if (missing.length || unknown.length) throw new LibraryTemplateInvalidError({ missing, unknown });
  return {
    renderLibraryPage({ recordingsJson }: { recordingsJson: string }): string {
      // JSON-escape the closing `</script>` so a recording field can't break out of the JSON island.
      const safe = recordingsJson.replace(/<\/script/gi, '<\\/script');
      return deps.template.replace(/\{\{RECORDINGS_JSON\}\}/g, () => safe);
    },
  };
}
