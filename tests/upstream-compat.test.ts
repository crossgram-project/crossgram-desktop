import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  patchUpstreamCompatibility,
  qtLibcborCollisions,
} from "../features/upstream-compat/patch.js";
import { targetById } from "../src/targets.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

async function fixture(eol = "\n"): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "crossgram-desktop-upstream-compat-"));
  temporaryDirectories.push(root);
  await mkdir(path.join(root, "Telegram/cmake"), { recursive: true });
  await writeFile(
    path.join(root, "Telegram/cmake/lib_fido2.cmake"),
    [
      "set(fido2_definitions _FIDO_INTERNAL HAVE_CBOR_H)",
      "target_compile_definitions(lib_fido2 PRIVATE ${fido2_definitions})",
      "target_link_libraries(lib_fido2 PUBLIC desktop-app::external_openssl)",
      "",
    ].join(eol),
    "utf8",
  );
  return root;
}

describe("upstream compatibility", () => {
  it("renames every Qt/libcbor collision for Windows and is idempotent", async () => {
    const root = await fixture();
    const options = { root, target: targetById("tdesktop-x64") };

    await patchUpstreamCompatibility(options);
    const first = await readFile(
      path.join(root, "Telegram/cmake/lib_fido2.cmake"),
      "utf8",
    );

    expect(qtLibcborCollisions).toEqual([
      "cbor_encode_uint",
      "cbor_encode_tag",
      "cbor_encode_null",
      "cbor_encode_double",
    ]);
    for (const symbol of qtLibcborCollisions) {
      const renamed = `crossgram_libcbor_${symbol.slice("cbor_".length)}`;
      expect(first.match(new RegExp(`${symbol}=${renamed}`, "g"))).toHaveLength(1);
    }
    expect(first).toContain("if (WIN32)");
    expect(first.indexOf("target_compile_definitions(lib_fido2 PRIVATE"))
      .toBeLessThan(first.indexOf("crossgram_libcbor_encode_double"));
    expect(first.indexOf("crossgram_libcbor_encode_double"))
      .toBeLessThan(first.indexOf("target_link_libraries(lib_fido2"));

    await patchUpstreamCompatibility(options);
    expect(await readFile(path.join(root, "Telegram/cmake/lib_fido2.cmake"), "utf8"))
      .toBe(first);
  });

  it("preserves CRLF in the patched CMake file", async () => {
    const root = await fixture("\r\n");
    await patchUpstreamCompatibility({ root, target: targetById("tdesktop-x64") });
    const source = await readFile(path.join(root, "Telegram/cmake/lib_fido2.cmake"), "utf8");
    expect(source.replaceAll("\r\n", "")).not.toContain("\n");
  });


  it("replaces AyuGram's missing generated language symbols", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "crossgram-desktop-ayugram-compat-"),
    );
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "Telegram/SourceFiles/ayu/utils"), {
      recursive: true,
    });
    const handlerPath = path.join(
      root,
      "Telegram/SourceFiles/ayu/ayu_url_handlers.cpp",
    );
    await writeFile(
      handlerPath,
      [
        "void ResolveUser() {",
        "\tUi::show(Ui::MakeInformBox(tr::ayu_UserNotFoundMessage()));",
        "}",
        "void ResolveChat() {",
        "\tUi::show(Ui::MakeInformBox(tr::ayu_UserNotFoundMessage()));",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    const helperPath = path.join(
      root,
      "Telegram/SourceFiles/ayu/utils/telegram_helpers.cpp",
    );
    await writeFile(
      helperPath,
      `[[nodiscard]] Info::Profile::Badge::Content ComputeExteraBadgeContent(
		not_null<PeerData*> peer) {
	return {};
}

void Badge(not_null<PeerData*> peer) {
	auto first = tr::ayu_DeveloperPopup(
								  tr::now,
								  lt_item,
								  TextWithEntities{peer->name()},
								  tr::rich);
	auto second = tr::ayu_SupporterPopup(
								  tr::now,
								  lt_item,
								  TextWithEntities{peer->name()},
								  tr::rich);
	auto third = tr::ayu_OfficialResourcePopup(
						   tr::now,
						   lt_item,
						   TextWithEntities{peer->name()},
						   tr::rich);
	auto fourth = tr::ayu_DeveloperPopup(
						   tr::now,
						   lt_item,
						   TextWithEntities{peer->name()},
						   tr::rich);
	auto fifth = tr::ayu_SupporterPopup(
				tr::now,
				lt_item,
				TextWithEntities{peer->name()},
				tr::rich);
}
QString formatTTL(int time, bool isDoc) {
	if (time == 0x7FFFFFFF) {
		return isDoc ? tr::ayu_OnePlayTTL(tr::now) : tr::ayu_OneViewTTL(tr::now);
	}
	return QString("%1s").arg(time);
}

void Registration(QString userName, QString formattedDate, bool isSelf) {
	auto resultText = TextWithEntities();
	resultText = tr::ayu_CreationDateUserApproximately(
						tr::now,
						lt_item1,
						TextWithEntities{userName},
						lt_item2,
						TextWithEntities{formattedDate},
						tr::rich
					);
	resultText = tr::ayu_CreationDateSelfApproximately(
						tr::now,
						lt_item,
						TextWithEntities{formattedDate},
						tr::rich
					);
	resultText = tr::ayu_CreationDateUserEarlier(
						tr::now,
						lt_item1,
						TextWithEntities{userName},
						lt_item2,
						TextWithEntities{formattedDate},
						tr::rich
					);
	resultText = tr::ayu_CreationDateSelfEarlier(
						tr::now,
						lt_item,
						TextWithEntities{formattedDate},
						tr::rich
					);
	resultText = tr::ayu_CreationDateUserLater(
						tr::now,
						lt_item1,
						TextWithEntities{userName},
						lt_item2,
						TextWithEntities{formattedDate},
						tr::rich
					);
	resultText = tr::ayu_CreationDateSelfLater(
						tr::now,
						lt_item,
						TextWithEntities{formattedDate},
						tr::rich
					);
}

void Channel(not_null<ChannelData*> channel, QString formattedDate) {
	auto result = tr::ayu_JoinDateChat(
			tr::now,
			lt_item1,
			TextWithEntities{channel->name()},
			lt_item2,
			TextWithEntities{formattedDate},
			tr::rich
		);
	result = tr::ayu_CreationDateChat(
			tr::now,
			lt_item1,
			TextWithEntities{channel->name()},
			lt_item2,
			TextWithEntities{formattedDate},
			tr::rich
		);
}

void Chat(not_null<ChatData*> chat, QString formattedDate) {
	auto result = tr::ayu_CreationDateChat(
			tr::now,
			lt_item1,
			TextWithEntities{chat->name()},
			lt_item2,
			TextWithEntities{formattedDate},
			tr::rich
		);
}
`,
      "utf8",
    );

    const options = { root, target: targetById("ayugram") };
    await patchUpstreamCompatibility(options);
    const firstHandler = await readFile(handlerPath, "utf8");
    const firstHelper = await readFile(helperPath, "utf8");
    expect(firstHandler).not.toContain("ayu_UserNotFoundMessage");
    expect(firstHandler.match(/lng_blocked_list_not_found\(tr::now\)/g)).toHaveLength(2);
    for (const symbol of [
      "ayu_DeveloperPopup",
      "ayu_SupporterPopup",
      "ayu_OfficialResourcePopup",
      "ayu_OnePlayTTL",
      "ayu_OneViewTTL",
      "ayu_CreationDateUserApproximately",
      "ayu_CreationDateSelfApproximately",
      "ayu_CreationDateUserEarlier",
      "ayu_CreationDateSelfEarlier",
      "ayu_CreationDateUserLater",
      "ayu_CreationDateSelfLater",
      "ayu_JoinDateChat",
      "ayu_CreationDateChat",
    ]) {
      expect(firstHelper).not.toContain(symbol);
    }
    expect(firstHelper).toContain("AyuBadgePopupText(");
    expect(firstHelper).toContain("AyuSelfCreationDateText(");
    expect(firstHelper).toContain('return isDoc ? u"one play"_q : u"one view"_q;');

    await patchUpstreamCompatibility(options);
    expect(await readFile(handlerPath, "utf8")).toBe(firstHandler);
    expect(await readFile(helperPath, "utf8")).toBe(firstHelper);
  });
  it("does not touch upstreams that do not vendor 64Gram's libfido2", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "crossgram-desktop-upstream-compat-none-"));
    temporaryDirectories.push(root);
    await expect(patchUpstreamCompatibility({ root, target: targetById("tdesktop") }))
      .resolves.toBeUndefined();
  });
});
