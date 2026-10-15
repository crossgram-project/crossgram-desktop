import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { patchMentionMatching } from "../features/mention-matching/patch.js";
import { targetById } from "../src/targets.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

// The two lambdas the patch rewrites, copied from upstream
// chat_helpers/field_autocomplete.cpp.
const matching = [
  "\t\tconst auto filterNotPassedByUsername = [&](UserData *user) {",
  "\t\t\tconst auto username = PrimaryUsername(user);",
  "\t\t\tif (username.startsWith(_filter, Qt::CaseInsensitive)) {",
  "\t\t\t\tconst auto exactUsername",
  "\t\t\t\t\t= (username.size() == _filter.size());",
  "\t\t\t\treturn exactUsername;",
  "\t\t\t}",
  "\t\t\treturn true;",
  "\t\t};",
  "\t\tconst auto filterNotPassedByName = [&](UserData *user) {",
  "\t\t\tfor (const auto &nameWord : user->nameWords()) {",
  "\t\t\t\tif (nameWord.startsWith(_filter, Qt::CaseInsensitive)) {",
  "\t\t\t\t\tconst auto exactUsername = !PrimaryUsername(user).compare(",
  "\t\t\t\t\t\t_filter,",
  "\t\t\t\t\t\tQt::CaseInsensitive);",
  "\t\t\t\t\treturn exactUsername;",
  "\t\t\t\t}",
  "\t\t\t}",
  "\t\t\treturn filterNotPassedByUsername(user);",
  "\t\t};",
].join("\n");

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "crossgram-desktop-mention-"));
  roots.push(root);
  const file = path.join(root, "Telegram/SourceFiles/chat_helpers/field_autocomplete.cpp");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${matching}\n`, "utf8");
  return root;
}

const autocomplete = "Telegram/SourceFiles/chat_helpers/field_autocomplete.cpp";

describe("mention matching desktop patch", () => {
  it("matches names and usernames by substring and is idempotent", async () => {
    const root = await fixture();
    const options = { root, target: targetById("tdesktop"), featureRoot: root };
    await patchMentionMatching(options);
    const first = await readFile(path.join(root, autocomplete), "utf8");
    expect(first).toContain("if (username.contains(_filter, Qt::CaseInsensitive)) {");
    expect(first).toContain("if (nameWord.contains(_filter, Qt::CaseInsensitive)) {");
    expect(first).not.toContain("startsWith(_filter, Qt::CaseInsensitive)");
    // The exact-username handoff to the "send to @username" row stays as it is.
    expect(first).toContain("\t\t\t\t\t= (username.size() == _filter.size());");
    expect(first).toContain("\t\t\t\treturn exactUsername;");
    expect(first).toContain("\t\t\treturn filterNotPassedByUsername(user);");
    await patchMentionMatching(options);
    expect(await readFile(path.join(root, autocomplete), "utf8")).toBe(first);
  });

  it.each(["tdesktop", "tdesktop-x64", "ayugram", "materialgram"])(
    "patches %s target",
    async (targetId) => {
      const root = await fixture();
      await patchMentionMatching({ root, target: targetById(targetId), featureRoot: root });
      expect(await readFile(path.join(root, autocomplete), "utf8"))
        .toContain("nameWord.contains(_filter, Qt::CaseInsensitive)");
    },
  );
});
