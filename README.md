# Crisp ASR

Crisp ASR is a desktop-only Obsidian plugin by **letschips** that connects
directly to Doubao Speech Recognition.

## Version 0.4.3

Crisp ASR keeps Doubao Speech Recognition as the dedicated transcription
engine and adds an optional, separate AI text-processing layer.

### Manual smart processing

- Finish a file or live transcription first, then explicitly choose
  `润色整理`, `重点提炼`, or `自定义`.
- Nothing is sent to a text model until the user clicks one of those actions.
- `润色整理` corrects punctuation, paragraphs, obvious ASR errors, filler
  words, and mechanical repetition without removing meaningful information.
- `重点提炼` removes rambling and repetition, then organizes key facts,
  conclusions, decisions, action items, owners, dates, and open questions.
- `自定义` runs the saved Prompt with support for `{{transcript}}`,
  `{{title}}`, `{{date}}`, `{{audio_file}}`, and `{{duration}}`.

### Provider choice

- Choose 火山方舟, OpenAI, Claude, DeepSeek, or a custom OpenAI-compatible
  endpoint.
- Ark, OpenAI, DeepSeek, and custom endpoints use the Chat Completions
  contract. Claude uses the native Anthropic Messages contract.
- The text-model Secret and model name are independent from the Doubao Speech
  Recognition Secret.
- Provider presets keep their official Base URL. The custom provider accepts a
  user-supplied Base URL.
- A short connection test validates the selected Secret, model, and endpoint.

### Preview and raw-transcript protection

- Processing opens a side-by-side preview with the untouched transcript and
  generated result.
- Users can regenerate, copy, discard, or explicitly write the result.
- The default write mode inserts a marked `## 智能整理` section immediately
  before the raw ASR section.
- Re-running smart processing replaces only the previous generated section.
- If the raw transcript changes while generation is running, Crisp ASR refuses
  the write and asks the user to regenerate.
- An optional output mode creates a separate linked smart-result note instead.
- Long transcripts are split at readable boundaries and processed in order;
  multi-part key extraction receives a final consolidation pass.
- Cancelling stops the workflow between provider calls and never writes a
  partial result.

### Data boundary

- Audio files, microphone input, and explicitly authorized computer audio are
  sent only to Volcengine for speech recognition.
- Transcript text is sent only to the AI provider selected by the user and
  only after a manual smart-processing action.
- Both Speech and AI API keys are stored through Obsidian SecretStorage rather
  than plugin `data.json`.
- Crisp ASR does not operate a proxy server.

## Version 0.3.2

- Add `About Crisp ASR` to the bottom of the settings page with the plugin's
  core purpose and the linked author attribution.

- Update the input meter and elapsed time without rebuilding the full sidebar,
  and preserve transcript scroll position when new text arrives.
- Keep every persistent job reachable through an expandable task list.
- Retry Volcengine `55xxxxxx` temporary service failures even when the HTTP
  response itself is successful.
- Cancel an in-progress live startup cleanly when the plugin unloads.
- Clarify no-note output behavior and use the full control width for
  computer-only capture.
- Move a legacy Crisp ASR plaintext `accessToken` into Obsidian
  SecretStorage and preserve its live resource ID during the first upgraded
  load.

- Choose microphone, computer audio, or computer audio plus microphone for
  live transcription.
- Use the macOS sharing picker for every computer-audio session. Crisp ASR
  never starts system capture silently and never reads or stores shared video.
- Select a preferred microphone and monitor the mixed input level in the
  sidebar.
- Optionally preserve the exact mixed ASR input as WebM/Opus under
  `Crisp ASR/Audio`; this remains disabled by default.
- Embed a saved live recording in the resulting Markdown transcript.
- Persist file-transcription jobs across restarts and run them serially.
- Retry temporary network, timeout, rate-limit, and service failures twice.
  Permanent authentication, missing-file, decode, and size failures remain in
  the panel for manual retry or removal.
- Resume interrupted queued or running jobs after Obsidian reloads.

- Use neutral real-time dictation wording for meetings, interviews, voice
  notes, classes, and other recording contexts.
- Avoid nested backdrop-blur compositor layers in Obsidian's translucent
  macOS window, which caused expanding shadows and screen trails during live
  updates.
- Show a compact floating live strip with elapsed time, transcript preview,
  panel access, and a safe stop-and-write action.
- Test the configured API key from settings or the command palette with a
  100 ms silent probe.
- Transcribe an audio attachment within two lines of the editor cursor.
- Control the panel and live session through
  `obsidian://crisp-asr?mode=open|start|stop|toggle`.
- Stop microphone capture and close the stream automatically after a live
  connection error.
- Start V1 streaming audio at sequence 2 because the full client request
  already consumes sequence 1.
- Bundle the Node WebSocket client required to attach Doubao authentication
  headers from Obsidian Desktop.
- Right-click supported audio files in the file explorer to transcribe them.
- Detect new Obsidian `Recording …` attachments when automatic transcription
  is enabled.
- Convert M4A, WebM, FLAC, AAC, and other browser-decodable audio to 16 kHz
  mono PCM WAV before calling the Doubao flash endpoint.
- Show live microphone transcription in a Crisp-styled right sidebar and
  append the final result to the note that was active when recording started.
- Store the API key through Obsidian SecretStorage rather than plugin data.

The plugin sends selected files and explicitly authorized microphone or
computer audio directly to Volcengine. It does not run a proxy service.
