# GhostPrompt -- Script de compilacion para PowerShell
# wasm-pack fue archivado en jul 2025; usamos cargo + wasm-bindgen-cli directamente.
#
# Uso:
#   .\build.ps1          # build release
#   .\build.ps1 -Dev     # build debug (mas rapido)
#   .\build.ps1 -Test    # correr tests Rust + JS
#   .\build.ps1 -Clean   # limpiar artefactos

param(
    [switch]$Dev,
    [switch]$Test,
    [switch]$Clean
)

$ErrorActionPreference = "Stop"
$WasmTarget = "wasm32-unknown-unknown"
$CrateName  = "ghost_prompt"
$OutDir     = "extension/pkg"

function Info  ($msg) { Write-Host "[ghost] $msg" -ForegroundColor Cyan   }
function Ok    ($msg) { Write-Host "[ghost] $msg" -ForegroundColor Green  }
function Warn  ($msg) { Write-Host "[ghost] $msg" -ForegroundColor Yellow }
function Abort ($msg) { Write-Host "[ghost] $msg" -ForegroundColor Red; exit 1 }

# ── Clean ─────────────────────────────────────────────────────────────────
if ($Clean) {
    Info "Limpiando artefactos..."
    if (Test-Path "target") { Remove-Item -Recurse -Force "target" }
    if (Test-Path $OutDir)  { Remove-Item -Recurse -Force $OutDir  }
    Ok "Listo."; exit 0
}

# ── Verificar / instalar Rust ─────────────────────────────────────────────
Info "Verificando Rust..."
if (-not (Get-Command rustc -ErrorAction SilentlyContinue)) {
    Warn "Rust no encontrado. Descargando rustup-init.exe..."
    $url = "https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe"
    $tmp = "$env:TEMP\rustup-init.exe"
    Invoke-WebRequest -Uri $url -OutFile $tmp
    & $tmp -y --default-toolchain stable
    Remove-Item $tmp
    $env:PATH += ";$env:USERPROFILE\.cargo\bin"
    Ok "Rust instalado."
}

# Agregar target WASM
$installed = rustup target list --installed
if ($installed -notcontains $WasmTarget) {
    Info "Agregando target $WasmTarget..."
    rustup target add $WasmTarget
}

# Instalar wasm-bindgen-cli con version exacta del Cargo.lock
if (-not (Get-Command wasm-bindgen -ErrorAction SilentlyContinue)) {
    Info "Instalando wasm-bindgen-cli..."
    $ver = "0.2.100"
    if (Test-Path "Cargo.lock") {
        $lines = Get-Content "Cargo.lock"
        $idx = 0
        for ($i = 0; $i -lt $lines.Count; $i++) {
            if ($lines[$i] -match 'name = "wasm-bindgen"' -and $lines[$i+1] -match 'version') {
                if ($lines[$i+1] -match '"([0-9]+\.[0-9]+\.[0-9]+)"') {
                    $ver = $Matches[1]; break
                }
            }
        }
    }
    Info "Instalando wasm-bindgen-cli@$ver ..."
    cargo install wasm-bindgen-cli --version $ver --locked
}

# ── Tests ─────────────────────────────────────────────────────────────────
if ($Test) {
    Info "Tests Rust (wasm32)..."
    cargo test --target $WasmTarget
    if ($LASTEXITCODE -ne 0) { Abort "Tests Rust fallaron." }

    Info "Tests JS (Vitest)..."
    npm test
    if ($LASTEXITCODE -ne 0) { Abort "Tests JS fallaron." }

    Ok "Todos los tests pasaron."; exit 0
}

# ── Build ─────────────────────────────────────────────────────────────────
$profile   = if ($Dev) { "debug" } else { "release" }
$releaseFlag = if ($Dev) { "" } else { "--release" }

Info "cargo build --target $WasmTarget $releaseFlag ..."
Invoke-Expression "cargo build --target $WasmTarget $releaseFlag"
if ($LASTEXITCODE -ne 0) { Abort "cargo build fallo." }

# ── wasm-bindgen ──────────────────────────────────────────────────────────
$wasmIn = "target/$WasmTarget/$profile/$CrateName.wasm"
if (-not (Test-Path $wasmIn)) { Abort "No se encontro: $wasmIn" }

Info "wasm-bindgen --target web $wasmIn --out-dir $OutDir"
New-Item -ItemType Directory -Force $OutDir | Out-Null
wasm-bindgen --target web $wasmIn --out-dir $OutDir
if ($LASTEXITCODE -ne 0) { Abort "wasm-bindgen fallo." }

# ── wasm-opt (opcional, solo release) ─────────────────────────────────────
if (-not $Dev) {
    if (Get-Command wasm-opt -ErrorAction SilentlyContinue) {
        Info "wasm-opt -Oz ..."
        $bg = "$OutDir/${CrateName}_bg.wasm"
        wasm-opt -Oz $bg -o $bg
        Ok "wasm-opt aplicado."
    } else {
        Warn "wasm-opt no encontrado (opcional). Para instalarlo: scoop install binaryen"
    }
}

# ── Resumen ────────────────────────────────────────────────────────────────
Ok "Build listo en ./$OutDir/"
Get-ChildItem $OutDir | ForEach-Object {
    $kb = [math]::Round($_.Length / 1KB, 1)
    Write-Host "    $($_.Name)  ($kb KB)" -ForegroundColor DarkGray
}
Write-Host ""
Ok "chrome://extensions -> Cargar descomprimida -> ./extension/"
