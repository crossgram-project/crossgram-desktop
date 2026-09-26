# Reaction support

QQ message reactions exist in groups only: its one-to-one chats have no reaction
at all. The relay still advertises the reaction catalog account-wide, and
Telegram Desktop answers `AllowedReactionsType::All` for every user, so an
unpatched client keeps offering a reaction button, selector and context entry in
one-to-one chats where the relay then rejects the send.

This feature asks the relay `crossgram.getFeatures` for a one-to-one chat when
it is opened and folds a `{"reactions":{"supported":false}}` answer into
`Data::PeerAllowedReactions`, which every reaction entry point already consults:

| Patch | Effect |
| --- | --- |
| `data/data_peer_values.cpp` | an explicitly refused peer reports an empty `AllowedReactionsType::Some` list, which renders as "no reactions available" |
| `window/window_session_controller.cpp` | the query is sent when a chat is opened, so the answer is ready for the first entry |
| `mtproto/scheme/api.tl` + `codegen/scheme/codegen_scheme.py` | registers `crossgram.getFeatures#c3e6b915` |
| `crossgram/reactions.{h,cpp}` | the per-session query, its cached answer and the peer-flag republish that refreshes an already-open chat |

Unknown stays "keep the client's own rules", so a server without the Crossgram
API behaves exactly like upstream. The poke feature issues the same query; the
patch script only ever adds one schema line, so both features coexist.
