import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { Project } from "../types";

export const isDesktop =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface ProjectEntry {
  path: string;
  json: string;
  updated: number;
  assets: string[];
}

export interface Settings {
  root: string;
  recent: string[];
}

export interface AssetData {
  mime: string;
  base64: string;
}

export interface CompileFile {
  path: string;
  text?: string;
  base64?: string;
}

export interface CompileResult {
  success: boolean;
  pdf: string | null;
  log: string;
}

const BROWSER_KEY = "xyj-browser-projects-v1";

function readBrowserEntries(): ProjectEntry[] {
  const raw = localStorage.getItem(BROWSER_KEY);
  if (raw) {
    const parsed = JSON.parse(raw) as ProjectEntry[];
    if (Array.isArray(parsed)) return parsed;
  }
  localStorage.setItem(BROWSER_KEY, JSON.stringify([]));
  return [];
}

function writeBrowserEntries(entries: ProjectEntry[]) {
  localStorage.setItem(BROWSER_KEY, JSON.stringify(entries));
}

export async function getSettings(): Promise<Settings> {
  if (!isDesktop) return { root: "浏览器项目", recent: [] };
  return invoke<Settings>("get_settings");
}

async function pickDirectory(title: string): Promise<string | null> {
  const picked = await open({ directory: true, multiple: false, title });
  if (typeof picked === "string") return picked;
  return null;
}

export async function chooseRoot(): Promise<Settings | null> {
  if (!isDesktop) return null;
  const root = await pickDirectory("选择项目根目录");
  if (!root) return null;
  return invoke<Settings>("set_root", { root });
}

export async function listProjectEntries(): Promise<ProjectEntry[]> {
  if (!isDesktop) {
    return readBrowserEntries().sort((left, right) => right.updated - left.updated);
  }
  return invoke<ProjectEntry[]>("list_projects");
}

export async function loadProjectEntry(path: string): Promise<ProjectEntry> {
  if (!isDesktop) {
    const entry = readBrowserEntries().find((item) => item.path === path);
    if (!entry) throw new Error("项目不存在");
    return entry;
  }
  return invoke<ProjectEntry>("load_project", { path });
}

export async function openProjectFolder(): Promise<ProjectEntry | null> {
  if (!isDesktop) throw new Error("打开文件夹仅在桌面应用中可用");
  const folder = await pickDirectory("打开项目文件夹");
  if (!folder) return null;
  return invoke<ProjectEntry>("load_project", { path: folder });
}

export async function createProjectEntry(
  name: string,
  project: Project,
): Promise<ProjectEntry> {
  const json = JSON.stringify(project, null, 2);
  if (!isDesktop) {
    const entries = readBrowserEntries();
    const path = `browser:${project.id}`;
    const entry: ProjectEntry = { path, json, updated: Date.now(), assets: [] };
    writeBrowserEntries([entry, ...entries]);
    return entry;
  }
  return invoke<ProjectEntry>("create_project", { name, json });
}

export interface ImportAssetRef {
  source: string;
  targetName: string;
}

export async function createProjectFromImport(
  name: string,
  project: Project,
  markdownPath: string,
  assets: ImportAssetRef[],
): Promise<ProjectEntry> {
  if (!isDesktop) throw new Error("从 Markdown 新建项目仅在桌面应用中可用");
  const json = JSON.stringify(project, null, 2);
  return invoke<ProjectEntry>("create_project_from_import", {
    name,
    json,
    markdownPath,
    assets,
  });
}

export interface PickedMarkdown {
  path: string;
  text: string;
}

export async function pickMarkdownFile(): Promise<PickedMarkdown | null> {
  if (!isDesktop) throw new Error("从 Markdown 新建项目仅在桌面应用中可用");
  const picked = await open({
    directory: false,
    multiple: false,
    title: "从结构化 Markdown 新建项目",
    filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
  });
  if (typeof picked !== "string") return null;
  const text = await invoke<string>("read_text_file", { path: picked });
  return { path: picked, text };
}

export async function duplicateProjectEntry(
  source: string,
  name: string,
  project: Project,
): Promise<ProjectEntry> {
  const json = JSON.stringify(project, null, 2);
  if (!isDesktop) {
    const entries = readBrowserEntries();
    const path = `browser:${project.id}`;
    const entry: ProjectEntry = {
      path,
      json,
      updated: Date.now(),
      assets: entries.find((item) => item.path === source)?.assets ?? [],
    };
    writeBrowserEntries([entry, ...entries]);
    return entry;
  }
  return invoke<ProjectEntry>("duplicate_project", { source, name, json });
}

export async function saveProjectEntry(path: string, project: Project): Promise<void> {
  const json = JSON.stringify(project, null, 2);
  if (!isDesktop) {
    const entries = readBrowserEntries().map((entry) =>
      entry.path === path ? { ...entry, json, updated: Date.now() } : entry,
    );
    writeBrowserEntries(entries);
    return;
  }
  await invoke("save_project", { path, json });
}

export async function deleteProjectEntry(path: string): Promise<void> {
  if (!isDesktop) {
    writeBrowserEntries(readBrowserEntries().filter((entry) => entry.path !== path));
    return;
  }
  await invoke("delete_project", { path });
}

export async function importAsset(
  projectPath: string,
  file: File,
): Promise<string> {
  const dataUrl = await readFileAsDataUrl(file);
  if (!isDesktop) return dataUrl;
  const base64 = dataUrl.split(",")[1] ?? "";
  return invoke<string>("import_asset", {
    projectPath,
    fileName: file.name,
    data: base64,
  });
}

export async function pickYamlFile(): Promise<string | null> {
  if (!isDesktop) throw new Error("导入 YAML 仅在桌面应用中可用");
  const picked = await open({
    directory: false,
    multiple: false,
    title: "导入内容 YAML",
    filters: [{ name: "YAML", extensions: ["yaml", "yml"] }],
  });
  if (typeof picked !== "string") return null;
  return invoke<string>("read_text_file", { path: picked });
}

export async function readAsset(projectPath: string, src: string): Promise<AssetData> {
  if (src.startsWith("data:")) {
    const match = /^data:([^;,]+)[;,](?:base64,)?(.*)$/s.exec(src);
    if (!match) throw new Error("图片数据格式无效");
    return { mime: match[1], base64: match[2] };
  }
  if (!isDesktop) {
    const response = await fetch(src);
    if (!response.ok) throw new Error("图片读取失败");
    const blob = await response.blob();
    const dataUrl = await readFileAsDataUrl(new File([blob], "image", { type: blob.type }));
    const match = /^data:([^;,]+)[;,](?:base64,)?(.*)$/s.exec(dataUrl);
    if (!match) throw new Error("图片数据格式无效");
    return { mime: match[1], base64: match[2] };
  }
  return invoke<AssetData>("read_asset", { projectPath, src });
}

export function assetDataUrl(asset: AssetData): string {
  return `data:${asset.mime};base64,${asset.base64}`;
}

export async function saveExport(
  defaultName: string,
  filterName: string,
  filterExtension: string,
  base64: string,
): Promise<string | null> {
  if (isDesktop) {
    return invoke<string | null>("save_export", {
      defaultName,
      filterName,
      filterExtension,
      data: base64,
    });
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const blob = new Blob([bytes]);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = defaultName;
  anchor.click();
  URL.revokeObjectURL(url);
  return defaultName;
}

export async function compileFiles(files: CompileFile[]): Promise<CompileResult> {
  if (!isDesktop) throw new Error("LaTeX 编译仅在桌面应用中可用");
  return invoke<CompileResult>("compile", { request: { files } });
}

export async function compileFolder(path: string): Promise<CompileResult> {
  if (!isDesktop) throw new Error("LaTeX 编译仅在桌面应用中可用");
  return invoke<CompileResult>("compile_folder", { path });
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

export function fileToBase64(file: File): Promise<string> {
  return readFileAsDataUrl(file).then((dataUrl) => dataUrl.split(",")[1] ?? "");
}
