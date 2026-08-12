import { PatchContext } from "../../src/core/patch-context.js";
import type { Target } from "../../src/targets.js";

interface PatchOptions {
  readonly root: string;
  readonly target: Target;
}

const libcborPrefix = "crossgram_libcbor_";

export const qtLibcborCollisions = [
  "cbor_encode_uint",
  "cbor_encode_tag",
  "cbor_encode_null",
  "cbor_encode_double",
] as const;

export async function patchUpstreamCompatibility(options: PatchOptions): Promise<void> {
  const context = new PatchContext(options.root, options.target, options.root);

  if (options.target.id === "ayugram") {
    await context.edit("Telegram/SourceFiles/ayu/ayu_url_handlers.cpp", (file) => {
      file.replaceEvery(
        "tr::ayu_UserNotFoundMessage()",
        "tr::lng_blocked_list_not_found(tr::now)",
      );
    });
    await context.edit(
      "Telegram/SourceFiles/ayu/utils/telegram_helpers.cpp",
      (file) => {
        file.insertBefore(
          "[[nodiscard]] Info::Profile::Badge::Content ComputeExteraBadgeContent(",
          `[[nodiscard]] TextWithEntities AyuBadgePopupText(
		const QString &name,
		const QString &description) {
	return TextWithEntities()
		.append(Ui::Text::Wrapped(
			TextWithEntities{ name },
			EntityType::Bold))
		.append(description);
}

[[nodiscard]] TextWithEntities AyuCreationDateText(
		const QString &name,
		const QString &relation,
		const QString &date) {
	return TextWithEntities()
		.append(Ui::Text::Wrapped(
			TextWithEntities{ name },
			EntityType::Bold))
		.append(relation)
		.append(Ui::Text::Wrapped(
			TextWithEntities{ date },
			EntityType::Bold))
		.append('.');
}

[[nodiscard]] TextWithEntities AyuSelfCreationDateText(
		const QString &relation,
		const QString &date) {
	return TextWithEntities(u"You created your account "_q)
		.append(relation)
		.append(Ui::Text::Wrapped(
			TextWithEntities{ date },
			EntityType::Bold))
		.append('.');
}

[[nodiscard]] TextWithEntities AyuJoinDateText(
		const QString &name,
		const QString &date) {
	return TextWithEntities(u"You joined "_q)
		.append(Ui::Text::Wrapped(
			TextWithEntities{ name },
			EntityType::Bold))
		.append(u" on "_q)
		.append(Ui::Text::Wrapped(
			TextWithEntities{ date },
			EntityType::Bold))
		.append('.');
}

`,
          "AyuJoinDateText(",
        );
        file.replaceEvery(
          `tr::ayu_DeveloperPopup(
								  tr::now,
								  lt_item,
								  TextWithEntities{peer->name()},
								  tr::rich)`,
          `AyuBadgePopupText(
								  peer->name(),
								  u" is a member of the exteraGram development team."_q)`,
        );
        file.replaceEvery(
          `tr::ayu_SupporterPopup(
								  tr::now,
								  lt_item,
								  TextWithEntities{peer->name()},
								  tr::rich)`,
          `AyuBadgePopupText(
								  peer->name(),
								  u" supported the development of exteraGram or AyuGram and received a unique badge."_q)`,
        );
        file.replaceEvery(
          `tr::ayu_DeveloperPopup(
						   tr::now,
						   lt_item,
						   TextWithEntities{peer->name()},
						   tr::rich)`,
          `AyuBadgePopupText(
						   peer->name(),
						   u" is a member of the exteraGram development team."_q)`,
        );
        file.replaceEvery(
          `tr::ayu_OfficialResourcePopup(
						   tr::now,
						   lt_item,
						   TextWithEntities{peer->name()},
						   tr::rich)`,
          `AyuBadgePopupText(
						   peer->name(),
						   u" is an official exteraGram or AyuGram resource."_q)`,
        );
        file.replaceEvery(
          `tr::ayu_SupporterPopup(
				tr::now,
				lt_item,
				TextWithEntities{peer->name()},
				tr::rich)`,
          `AyuBadgePopupText(
				peer->name(),
				u" supported the development of exteraGram or AyuGram and received a unique badge."_q)`,
        );
        file.replace(
          "return isDoc ? tr::ayu_OnePlayTTL(tr::now) : tr::ayu_OneViewTTL(tr::now);",
          `return isDoc ? u"one play"_q : u"one view"_q;`,
        );
        file.replaceEvery(
          `tr::ayu_CreationDateUserApproximately(
						tr::now,
						lt_item1,
						TextWithEntities{userName},
						lt_item2,
						TextWithEntities{formattedDate},
						tr::rich
					)`,
          `AyuCreationDateText(
						userName,
						u" created their account approximately on "_q,
						formattedDate)`,
        );
        file.replaceEvery(
          `tr::ayu_CreationDateSelfApproximately(
						tr::now,
						lt_item,
						TextWithEntities{formattedDate},
						tr::rich
					)`,
          `AyuSelfCreationDateText(
						u"approximately on "_q,
						formattedDate)`,
        );
        file.replaceEvery(
          `tr::ayu_CreationDateUserEarlier(
						tr::now,
						lt_item1,
						TextWithEntities{userName},
						lt_item2,
						TextWithEntities{formattedDate},
						tr::rich
					)`,
          `AyuCreationDateText(
						userName,
						u" created their account earlier than "_q,
						formattedDate)`,
        );
        file.replaceEvery(
          `tr::ayu_CreationDateSelfEarlier(
						tr::now,
						lt_item,
						TextWithEntities{formattedDate},
						tr::rich
					)`,
          `AyuSelfCreationDateText(
						u"earlier than "_q,
						formattedDate)`,
        );
        file.replaceEvery(
          `tr::ayu_CreationDateUserLater(
						tr::now,
						lt_item1,
						TextWithEntities{userName},
						lt_item2,
						TextWithEntities{formattedDate},
						tr::rich
					)`,
          `AyuCreationDateText(
						userName,
						u" created their account later than "_q,
						formattedDate)`,
        );
        file.replaceEvery(
          `tr::ayu_CreationDateSelfLater(
						tr::now,
						lt_item,
						TextWithEntities{formattedDate},
						tr::rich
					)`,
          `AyuSelfCreationDateText(
						u"later than "_q,
						formattedDate)`,
        );
        file.replaceEvery(
          `tr::ayu_JoinDateChat(
			tr::now,
			lt_item1,
			TextWithEntities{channel->name()},
			lt_item2,
			TextWithEntities{formattedDate},
			tr::rich
		)`,
          `AyuJoinDateText(
			channel->name(),
			formattedDate)`,
        );
        file.replaceEvery(
          `tr::ayu_CreationDateChat(
			tr::now,
			lt_item1,
			TextWithEntities{channel->name()},
			lt_item2,
			TextWithEntities{formattedDate},
			tr::rich
		)`,
          `AyuCreationDateText(
			channel->name(),
			u" was created on "_q,
			formattedDate)`,
        );
        file.replaceEvery(
          `tr::ayu_CreationDateChat(
			tr::now,
			lt_item1,
			TextWithEntities{chat->name()},
			lt_item2,
			TextWithEntities{formattedDate},
			tr::rich
		)`,
          `AyuCreationDateText(
			chat->name(),
			u" was created on "_q,
			formattedDate)`,
        );
      },
    );
    return;
  }

  if (options.target.id !== "tdesktop-x64") return;

  const definitions = qtLibcborCollisions
    .map((symbol) => `        ${symbol}=${libcborPrefix}${symbol.slice("cbor_".length)}`)
    .join("\n");

  await context.edit("Telegram/cmake/lib_fido2.cmake", (file) => {
    file.insertAfter(
      "target_compile_definitions(lib_fido2 PRIVATE ${fido2_definitions})",
      [
        "",
        "# Qt 6 bundles TinyCBOR in QtCore. Its C symbols overlap with the",
        "# incompatible libcbor API vendored by 64Gram, so isolate the libcbor",
        "# names on Windows before the two static libraries reach the final link.",
        "if (WIN32)",
        "    target_compile_definitions(lib_fido2",
        "    PRIVATE",
        definitions,
        "    )",
        "endif()",
      ].join("\n"),
      `${libcborPrefix}encode_double`,
    );
  });
}
