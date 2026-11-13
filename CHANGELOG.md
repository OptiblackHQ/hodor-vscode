# Changelog

## 0.5.0

- New chat design, like Claude Code: input box with attach, mode, model and a round send / stop button; reads and searches fold into one line; tables, links, quotes and nested lists in answers.
- History: every chat is saved per project; reopen to continue, or delete.
- Modes: Plan (approve the plan to start), Ask before edits, Edit automatically, Full access.
- Model picker: Claude Opus, Sonnet, Haiku, and the Gemini models your key allows.
- Commands up to 10 minutes; dev servers in the background (start, read output, stop).
- Spend in dollars and a monthly Claude budget on Hodor's MCP / CLI page.

## 0.4.0

- Your own AI key, for every product and repo: Claude or Google Gemini (free Gemini keys work). Added once on Hodor's MCP / CLI page; pick the AI at the top of the chat.
- Screenshots: paste, drop or attach up to 4 images per message.
- Several repos at once: a folder of repos or a multi-root workspace. The chat knows each repo's language and runs commands in the right folder.
- Never writes `.github`, `.vscode` and similar folders inside nested repos either.

## 0.3.0

- The chat is now a coding agent: any coding task in the open project, with Hodor's tracking plan as its specialty.
- It decides where each event goes itself instead of asking.
- Events pasted into the chat (not in Hodor) are implemented in the code.
- Runs commands (install, build, test) after you click **Run**, with live output; reads VS Code's Problems panel to check its work.
- Answers are formatted, with **Copy** on code blocks and on each answer.

## 0.2.0

- AI chat: ask about the tracking plan, or have it add events to your code with Hodor's tracking code. Live progress, review or auto-apply, Stop / Retry / Continue. Uses the product's Claude key through Hodor; the key never reaches the editor.
- Events are marked implemented when their change is applied.

## 0.1.0

- Sign in to Hodor from the editor (device login; token in the OS keychain).
- Pick a product per workspace, defaulting to the repo's .hodor.json.
- Events grouped by status, with search.
- Event details panel; copy an event's tracking code or the whole file in any of the product's languages.
- Set event status, including the new "implemented".
