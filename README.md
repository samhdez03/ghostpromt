# GhostPrompt v0.2.0

Anonimizacion bidireccional de PII para LLMs. Todo ocurre localmente en WebAssembly.

## Compatibilidad

  Browser         Version minima   Notas
  Chrome          103+             MV3 + wasm-unsafe-eval
  Brave           1.40+            Basado en Chromium, compatible directo
  Opera           89+              Basado en Chromium, compatible directo
  Edge            103+             Basado en Chromium, compatible directo
  Firefox         128+             MV3 gecko, usa background scripts no service worker

  ¿Edge? Si. ¿Safari? No (no soporta wasm-unsafe-eval en extensiones aun).
  ¿Bing? Bing es un sitio web, no un navegador. Si usas Edge con Bing, funciona.

## Build (PowerShell)

  .\build.ps1          # instala dependencias + compila release
  .\build.ps1 -Dev     # build debug
  .\build.ps1 -Test    # tests Rust + JS
  .\build.ps1 -Clean   # limpiar

## Instalar en Chrome / Brave / Opera / Edge

  1. chrome://extensions (o brave://extensions, opera://extensions)
  2. Activar Modo desarrollador
  3. Cargar descomprimida -> carpeta extension/

## Instalar en Firefox

  1. about:debugging -> Este Firefox
  2. Cargar complemento temporal -> extension/manifest.json

## Estructura

  ghost-prompt/
  |- src/lib.rs                  Rust: PII + hash + anonymize + rehydrate
  |- .cargo/config.toml          Test runner wasm32
  |- build.ps1                   Script PowerShell
  |- extension/
  |  |- manifest.json            MV3 compatible multi-browser
  |  |- background.js            Service worker (Chrome) / bg script (Firefox)
  |  |- ghost-stream.js          Buffer SSE (sin export, script clasico)
  |  |- content-script.js        Intercepta prompt y DOM
  |  |- popup.html / popup.js    UI del icono de la extension
  |  |- styles/ghost.css         Capa visual privada
  |  |- styles/popup.css         Estilos del popup
  |  `- pkg/                     Generado por wasm-bindgen (no commitear)
  |- tests/ghost.test.js         Vitest SSE tests
  |- Cargo.toml
  `- package.json
