import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { resolvePromptAppend, resolvePromptTemplateFile } from "./resolve-file-uri"

describe("resolvePromptAppend", () => {
  const fixtureRoot = join(tmpdir(), `resolve-file-uri-${Date.now()}`)
  const configDir = join(fixtureRoot, "config")

  // fixture inside ~/.config/opencode/ - an allowed home subdirectory
  const opencodeConfigDir = join(homedir(), ".config", "opencode")
  const testSubdir = join(opencodeConfigDir, `.omo-test-${Date.now()}`)
  const allowedHomeFile = join(testSubdir, "prompt.txt")
  const arbitraryHomeFile = join(homedir(), `.omo-test-arbitrary-${Date.now()}.txt`)

  const absoluteFilePath = join(fixtureRoot, "absolute.txt")
  const relativeFilePath = join(configDir, "relative.txt")
  const spacedFilePath = join(fixtureRoot, "with space.txt")
  const escapedFilePath = join(fixtureRoot, "escaped.txt")
  const linkedAbsolutePath = join(configDir, "linked-absolute.txt")

  beforeAll(() => {
    mkdirSync(fixtureRoot, { recursive: true })
    mkdirSync(configDir, { recursive: true })
    mkdirSync(testSubdir, { recursive: true })

    writeFileSync(absoluteFilePath, "absolute-content", "utf8")
    writeFileSync(relativeFilePath, "relative-content", "utf8")
    writeFileSync(spacedFilePath, "encoded-content", "utf8")
    writeFileSync(escapedFilePath, "escaped-content", "utf8")
    writeFileSync(allowedHomeFile, "home-prompt-content", "utf8")
    writeFileSync(arbitraryHomeFile, "secret-content", "utf8")
    symlinkSync(absoluteFilePath, linkedAbsolutePath)
  })

  afterAll(() => {
    rmSync(fixtureRoot, { recursive: true, force: true })
    rmSync(testSubdir, { recursive: true, force: true })
    rmSync(arbitraryHomeFile, { force: true })
  })

  test("returns non-file URI strings unchanged", () => {
    //#given
    const input = "append this text"

    //#when
    const resolved = resolvePromptAppend(input)

    //#then
    expect(resolved).toBe(input)
  })

  test("resolves absolute file URI to file contents", () => {
    //#given
    const input = `file://${absoluteFilePath}`

    //#when
    const resolved = resolvePromptAppend(input, fixtureRoot)

    //#then
    expect(resolved).toBe("absolute-content")
  })

  test("resolves relative file URI using configDir", () => {
    //#given
    const input = "file://./relative.txt"

    //#when
    const resolved = resolvePromptAppend(input, configDir)

    //#then
    expect(resolved).toBe("relative-content")
  })

  test("resolves file URI under ~/.config/opencode/ via tilde expansion (issue #4593)", () => {
    //#given
    const relativePath = allowedHomeFile.slice(homedir().length + 1)
    const input = `file://~/${relativePath}`

    //#when
    const resolved = resolvePromptAppend(input, configDir)

    //#then
    expect(resolved).toBe("home-prompt-content")
  })

  test("resolves percent-encoded URI path", () => {
    //#given
    const input = `file://${encodeURIComponent(spacedFilePath)}`

    //#when
    const resolved = resolvePromptAppend(input, fixtureRoot)

    //#then
    expect(resolved).toBe("encoded-content")
  })

  test("returns warning for malformed percent-encoding", () => {
    //#given
    const input = "file://%E0%A4%A"

    //#when
    const resolved = resolvePromptAppend(input)

    //#then
    expect(resolved).toContain("[WARNING: Malformed file URI")
  })

  test("returns warning when file does not exist", () => {
    //#given
    const input = "file://./missing.txt"

    //#when
    const resolved = resolvePromptAppend(input, configDir)

    //#then
    expect(resolved).toContain("[WARNING: Could not resolve file URI")
  })

  test("rejects absolute file URI outside configDir and allowed home dirs", () => {
    //#given
    const input = `file://${absoluteFilePath}`

    //#when
    const resolved = resolvePromptAppend(input, configDir)

    //#then
    expect(resolved).toContain("[WARNING: Path rejected:")
    expect(resolved).not.toContain("absolute-content")
  })

  test("rejects traversal file URI that escapes configDir", () => {
    //#given
    const input = "file://../escaped.txt"

    //#when
    const resolved = resolvePromptAppend(input, configDir)

    //#then
    expect(resolved).toContain("[WARNING: Path rejected:")
    expect(resolved).not.toContain("escaped-content")
  })

  test("rejects symlink file URI that escapes configDir", () => {
    //#given
    const input = "file://./linked-absolute.txt"

    //#when
    const resolved = resolvePromptAppend(input, configDir)

    //#then
    expect(resolved).toContain("[WARNING: Path rejected:")
    expect(resolved).not.toContain("absolute-content")
  })

  test("rejects file URI under home directory but outside allowed subdirs", () => {
    //#given
    const input = `file://${arbitraryHomeFile}`

    //#when
    const resolved = resolvePromptAppend(input, configDir)

    //#then
    expect(resolved).toContain("[WARNING: Path rejected:")
    expect(resolved).not.toContain("secret-content")
  })
})

describe("resolvePromptTemplateFile", () => {
  const fixtureRoot = join(tmpdir(), `resolve-template-file-${Date.now()}`)
  const configDir = join(fixtureRoot, "config")
  const templatePath = join(configDir, "template.md")

  beforeAll(() => {
    mkdirSync(configDir, { recursive: true })
    writeFileSync(templatePath, "{{ taskSystemGuide }}", "utf8")
  })

  afterAll(() => {
    rmSync(fixtureRoot, { recursive: true, force: true })
  })

  test("#given 合法 file URI #when 解析 #then 返回路径与内容", () => {
    const resolved = resolvePromptTemplateFile(`file://${templatePath}`, configDir)
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.filePath).toBe(templatePath)
    expect(resolved.content).toBe("{{ taskSystemGuide }}")
  })

  test("#given 非 file URI #when 解析 #then 结构化报错", () => {
    const resolved = resolvePromptTemplateFile("/plain/path.md", configDir)
    expect(resolved.ok).toBe(false)
    if (resolved.ok) return
    expect(resolved.reason).toContain("file://")
  })

  test("#given 文件不存在 #when 解析 #then 结构化报错含路径", () => {
    const missing = join(configDir, "missing.md")
    const resolved = resolvePromptTemplateFile(`file://${missing}`, configDir)
    expect(resolved.ok).toBe(false)
    if (resolved.ok) return
    expect(resolved.reason).toContain("Template file not found")
    expect(resolved.reason).toContain(missing)
  })

  test("#given 逃逸路径 #when 解析 #then 结构化报错且不读文件", () => {
    const resolved = resolvePromptTemplateFile("file:///etc/passwd", configDir)
    expect(resolved.ok).toBe(false)
    if (resolved.ok) return
    expect(resolved.reason).toContain("Path rejected")
  })
})
