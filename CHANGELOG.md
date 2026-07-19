# Changelog

## 0.1.2 Beta — 2026-07-19

Adds a complete local attachment workflow to Frakio Work. Images and common files can now be selected or dragged into the composer, previewed before sending, persisted with conversation history, and delivered to Hermes Agent through native image routing or controlled local file paths. Sent images render as full thumbnails and open in an accessible in-app full-window preview.

This release also repairs several conversation UI regressions. The conversation settings popover now stays above message content, the resource sidebar resizes the conversation instead of covering it, and the left sidebar resumes automatic animated collapsing as the window narrows. Attachment storage now streams content safely from the hidden local data directory, validates stored paths, cleans abandoned drafts, and uses Bridge protocol version 2 so incompatible runtimes cannot silently ignore files.

## 0.1.1 Beta — 2026-07-18

Repairs the first public macOS packages. The bundled Hermes Runtime now includes and validates `aiohttp 3.14.1`, the OpenAI-compatible Runtime API is exercised during release builds, packaged apps report the correct version, and desktop shutdown waits for owned Runtime processes. The launch screen no longer cross-renders or clips its working and welcome states, fonts are bundled for offline use, Runtime failures show a concise status with expandable logs, global search is functional, and automatic startup preserves existing Hermes configuration and credentials.

Known issue in v0.1.0: the clean bundled Runtime omitted `aiohttp`, so the Runtime API could not start; ASAR packaging also caused the update screen to display `v0.0.0`.

## 0.1.0 Beta — 2026-07-18

First public beta of Frakio Work. Includes the cross-platform source Web UI, local Hermes Agent integration, macOS desktop packaging for Apple Silicon and Intel, runtime management, GitHub Release update checks, backup-first Hermes updates, explicit telemetry consent, and local API hardening.
