import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { isWithinProject } from "../../shared/contains-path"
import { log } from "../../shared/logger"

const ALLOWED_HOME_SUBDIRS = [
  join(homedir(), ".config", "opencode"),
  join(homedir(), ".config", "oh-my-openagent"),
  join(homedir(), ".omo"),
  join(homedir(), ".opencode"),
] as const

function isWithinAllowedPaths(filePath: string, projectRoot: string): boolean {
  if (isWithinProject(filePath, projectRoot)) return true
  for (const dir of ALLOWED_HOME_SUBDIRS) {
    if (isWithinProject(filePath, dir)) return true
  }
  return false
}

type FileUriPathResolution =
  | { readonly ok: true; readonly filePath: string }
  | { readonly ok: false; readonly reason: string }

// ponytail: fileURLToPath correctly handles standard file:/// URIs on Windows
// (drive letters, separator normalization). Non-standard legacy formats
// (file://path, file://~/..., file://./relative) fall through to the fallback below.
function resolveFileUriPath(uri: string, configDir?: string): FileUriPathResolution {
  let filePath: string
  try {
    filePath = fileURLToPath(uri)
  } catch {
    const encoded = uri.slice(7)
    try {
      const decoded = decodeURIComponent(encoded)
      const expanded = decoded.startsWith("~/") ? decoded.replace(/^~\//, `${homedir()}/`) : decoded
      filePath = isAbsolute(expanded)
        ? expanded
        : resolve(configDir ?? process.cwd(), expanded)
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error
      }
      return { ok: false, reason: `Malformed file URI (invalid percent-encoding): ${uri}` }
    }
  }

  const projectRoot = configDir ?? process.cwd()
  if (!isWithinAllowedPaths(filePath, projectRoot)) {
    log("[resolve-file-uri] Rejected file URI outside allowed paths", {
      promptAppend: uri,
      filePath,
      projectRoot,
      allowedHomeSubdirs: [...ALLOWED_HOME_SUBDIRS],
    })
    return {
      ok: false,
      reason: `Path rejected: ${uri} (resolved outside project root ${projectRoot} and allowed home directories; file:// prompts must reside within the project directory, ~/.config/opencode/, ~/.config/oh-my-openagent/, ~/.omo/, or ~/.opencode/)`,
    }
  }

  return { ok: true, filePath }
}

export function resolvePromptAppend(promptAppend: string, configDir?: string): string {
  if (!promptAppend.startsWith("file://")) return promptAppend

  const pathResolution = resolveFileUriPath(promptAppend, configDir)
  if (!pathResolution.ok) return `[WARNING: ${pathResolution.reason}]`

  if (!existsSync(pathResolution.filePath)) {
    return `[WARNING: Could not resolve file URI: ${promptAppend}]`
  }

  try {
    return readFileSync(pathResolution.filePath, "utf8")
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    return `[WARNING: Could not read file: ${promptAppend}]`
  }
}

export type PromptTemplateFileResolution =
  | { readonly ok: true; readonly filePath: string; readonly content: string }
  | { readonly ok: false; readonly reason: string }

export function resolvePromptTemplateFile(uri: string, configDir?: string): PromptTemplateFileResolution {
  if (!uri.startsWith("file://")) {
    return { ok: false, reason: `prompt_template must be a file:// URI, got: ${uri}` }
  }

  const pathResolution = resolveFileUriPath(uri, configDir)
  if (!pathResolution.ok) return { ok: false, reason: pathResolution.reason }

  if (!existsSync(pathResolution.filePath)) {
    return { ok: false, reason: `Template file not found: ${pathResolution.filePath}` }
  }

  try {
    return { ok: true, filePath: pathResolution.filePath, content: readFileSync(pathResolution.filePath, "utf8") }
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    return { ok: false, reason: `Could not read template file: ${pathResolution.filePath}` }
  }
}
