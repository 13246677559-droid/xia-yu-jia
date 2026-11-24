import { useEffect, useMemo, useRef, useState } from "react";
import { cloneProject, createProject } from "./data";
import { Editor } from "./components/Editor";
import { Home } from "./components/Home";
import { Icon } from "./components/Icons";
import type { Project, ThemeId } from "./types";
import {
  assetDataUrl,
  chooseRoot,
  createProjectEntry,
  createProjectFromImport,
  deleteProjectEntry,
  duplicateProjectEntry,
  importAsset,
  isDesktop,
  listProjectEntries,
  loadProjectEntry,
  openProjectFolder,
  pickMarkdownFile,
  readAsset,
  saveProjectEntry,
  type ProjectEntry,
} from "./lib/backend";
import { parseProject, parseProjectJson } from "./lib/project/schema";
import { buildProjectFromDeck } from "./lib/mdimport/build";
import { parseDeckMarkdown } from "./lib/mdimport/parse";
import {
  MarkdownImportError,
  type MarkdownIssue,
} from "./lib/mdimport/types";

const STORAGE_KEY = "xia-yu-jia-projects-v3";

interface ProjectRecord {
  entry: ProjectEntry;
  project: Project;
}

function figureSources(project: Project): string[] {
  const sources = new Set<string>();
  for (const section of project.sections) {
    for (const slide of section.slides) {
      for (const block of slide.blocks) {
        if (block.kind === "figure" && block.src && !block.src.startsWith("data:")) {
          sources.add(block.src);
        }
      }
    }
  }
  return [...sources].sort();
}

export default function App() {
  const [records, setRecords] = useState<ProjectRecord[]>([]);
  const [view, setView] = useState<"home" | "editor">("home");
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [assetUrls, setAssetUrls] = useState<Map<string, string>>(new Map());
  const [toast, setToast] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [importIssues, setImportIssues] = useState<MarkdownIssue[] | null>(null);
  const [importingMarkdown, setImportingMarkdown] = useState(false);
  const toastTimer = useRef<number | null>(null);
  const saveTimers = useRef(new Map<string, number>());
  const pendingSaves = useRef(new Map<string, Project>());

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
  };

  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      for (const timer of saveTimers.current.values()) window.clearTimeout(timer);
    },
    [],
  );

  useEffect(() => {
    if (!isDesktop) localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
  }, []);

  const readEntries = async (entries: ProjectEntry[]): Promise<ProjectRecord[]> => {
    const parsed: ProjectRecord[] = [];
    const errors: string[] = [];
    for (const entry of entries) {
      try {
        parsed.push({ entry, project: parseProjectJson(entry.json) });
      } catch (error) {
        errors.push(
          `${entry.path}：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (errors.length > 0) {
      showToast(errors[0]);
    }
    return parsed;
  };

  const refresh = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const entries = await listProjectEntries();
      const next = await readEntries(entries);
      setRecords(next);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "载入项目失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = records.find((record) => record.entry.path === currentPath) ?? null;
  const currentAssetKey = useMemo(
    () => (current ? figureSources(current.project).join("|") : ""),
    [current?.project.sections],
  );

  useEffect(() => {
    if (!current || !isDesktop) {
      setAssetUrls(new Map());
      return;
    }
    let cancelled = false;
    const sources = figureSources(current.project);
    const path = current.entry.path;
    void (async () => {
      const map = new Map<string, string>();
      for (const source of sources) {
        try {
          const data = await readAsset(path, source);
          map.set(source, assetDataUrl(data));
        } catch {
          // 缺失图片在预览中保持空位，编译时会给出具体错误。
        }
      }
      if (!cancelled) setAssetUrls(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [current?.entry.path, currentAssetKey]);

  const openPath = async (path: string) => {
    try {
      const entry = await loadProjectEntry(path);
      const project = parseProjectJson(entry.json);
      setRecords((previous) => {
        const rest = previous.filter((record) => record.entry.path !== entry.path);
        return [{ entry, project }, ...rest];
      });
      setCurrentPath(entry.path);
      setView("editor");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "打开项目失败");
    }
  };

  const scheduleSave = (path: string, project: Project) => {
    pendingSaves.current.set(path, project);
    const existing = saveTimers.current.get(path);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(async () => {
      saveTimers.current.delete(path);
      const latest = pendingSaves.current.get(path);
      pendingSaves.current.delete(path);
      if (!latest) return;
      try {
        parseProject(latest);
        await saveProjectEntry(path, latest);
      } catch (error) {
        showToast(error instanceof Error ? error.message : "保存失败");
      }
    }, 800);
    saveTimers.current.set(path, timer);
  };

  const update = (next: Project) => {
    if (!currentPath) return;
    const stamped: Project = { ...next, updated: new Date().toISOString() };
    setRecords((previous) =>
      previous.map((record) =>
        record.entry.path === currentPath
          ? {
              project: stamped,
              entry: { ...record.entry, updated: Date.now() },
            }
          : record,
      ),
    );
    scheduleSave(currentPath, stamped);
  };

  const create = async (name: string, theme: ThemeId) => {
    try {
      const project = createProject(name, theme);
      parseProject(project);
      const entry = await createProjectEntry(project.name, project);
      setRecords((previous) => [{ entry, project }, ...previous]);
      setCurrentPath(entry.path);
      setView("editor");
      showToast("项目已创建");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "创建项目失败");
    }
  };

  const importMarkdown = async () => {
    if (importingMarkdown) return;
    if (!isDesktop) {
      showToast("从 Markdown 新建项目仅在桌面应用中可用");
      return;
    }
    setImportingMarkdown(true);
    try {
      const picked = await pickMarkdownFile();
      if (!picked) return;
      const deck = parseDeckMarkdown(picked.text);
      const built = buildProjectFromDeck(deck);
      parseProject(built.project);
      const entry = await createProjectFromImport(
        built.project.name,
        built.project,
        picked.path,
        built.assets,
      );
      const timer = saveTimers.current.get(entry.path);
      if (timer) window.clearTimeout(timer);
      saveTimers.current.delete(entry.path);
      pendingSaves.current.delete(entry.path);
      setRecords((previous) => [
        { entry, project: built.project },
        ...previous.filter((record) => record.entry.path !== entry.path),
      ]);
      setCurrentPath(entry.path);
      setView("editor");
      showToast("已从 Markdown 新建项目");
    } catch (error) {
      if (error instanceof MarkdownImportError) {
        setImportIssues(error.issues);
      } else {
        showToast(error instanceof Error ? error.message : "导入失败");
      }
    } finally {
      setImportingMarkdown(false);
    }
  };

  const duplicate = async (path: string) => {
    const record = records.find((item) => item.entry.path === path);
    if (!record) return;
    try {
      const copy = cloneProject(record.project);
      copy.updated = new Date().toISOString();
      parseProject(copy);
      const entry = await duplicateProjectEntry(path, copy.name, copy);
      setRecords((previous) => [{ entry, project: copy }, ...previous]);
      showToast("项目已复制");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "复制项目失败");
    }
  };

  const rename = async (path: string, name: string) => {
    const record = records.find((item) => item.entry.path === path);
    const nextName = name.trim();
    if (!record || !nextName || nextName === record.project.name) return;
    try {
      const next: Project = {
        ...record.project,
        name: nextName,
        updated: new Date().toISOString(),
      };
      parseProject(next);
      await saveProjectEntry(path, next);
      setRecords((previous) =>
        previous.map((item) =>
          item.entry.path === path
            ? { ...item, project: next, entry: { ...item.entry, updated: Date.now() } }
            : item,
        ),
      );
      showToast("项目已重命名");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "重命名失败");
    }
  };

  const remove = async (path: string) => {
    const record = records.find((item) => item.entry.path === path);
    if (!record) return;
    try {
      await deleteProjectEntry(path);
      setRecords((previous) => previous.filter((item) => item.entry.path !== path));
      if (currentPath === path) {
        setCurrentPath(null);
        setView("home");
      }
      showToast("项目已删除");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "删除项目失败");
    }
  };

  const chooseProjectRoot = async () => {
    try {
      const settings = await chooseRoot();
      if (!settings) return;
      showToast("项目目录已更新");
      await refresh();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "更换项目目录失败");
    }
  };

  const openFolder = async () => {
    try {
      const entry = await openProjectFolder();
      if (!entry) return;
      const project = parseProjectJson(entry.json);
      setRecords((previous) => {
        const rest = previous.filter((record) => record.entry.path !== entry.path);
        return [{ entry, project }, ...rest];
      });
      setCurrentPath(entry.path);
      setView("editor");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "打开文件夹失败");
    }
  };

  const importFigure = async (file: File): Promise<string> => {
    if (!currentPath) throw new Error("当前项目未打开");
    return importAsset(currentPath, file);
  };

  const summary = useMemo(
    () =>
      records.map((record) => ({
        path: record.entry.path,
        project: record.project,
        updated: record.entry.updated,
      })),
    [records],
  );

  if (loading) {
    return (
      <div className="app loading-screen">
        <span>载入项目</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="app loading-screen">
        <div className="load-error">
          <p>{loadError}</p>
          <button className="btn primary" onClick={() => void refresh()}>
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {view === "editor" && current ? (
        <Editor
          key={current.entry.path}
          project={current.project}
          projectPath={current.entry.path}
          assetUrls={assetUrls}
          projects={records.map((record) => ({
            path: record.entry.path,
            name: record.project.name,
            theme: record.project.theme,
          }))}
          onSwitchProject={(path) => {
            void openPath(path);
          }}
          onChange={update}
          onBack={() => {
            setView("home");
            setCurrentPath(null);
          }}
          onToast={showToast}
          onImportAsset={importFigure}
        />
      ) : (
        <Home
          projects={summary}
          onOpen={openPath}
          onCreate={create}
          onDuplicate={duplicate}
          onDelete={remove}
          onRename={rename}
          onOpenFolder={openFolder}
          onChooseRoot={chooseProjectRoot}
          onImportMarkdown={importMarkdown}
          importingMarkdown={importingMarkdown}
        />
      )}
      {importIssues && (
        <div className="modal-overlay" onMouseDown={() => setImportIssues(null)}>
          <div
            className="modal import-error-modal"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <h3>Markdown 校验未通过</h3>
              <button
                className="icon-btn"
                onClick={() => setImportIssues(null)}
                aria-label="关闭"
              >
                <Icon name="close" />
              </button>
            </div>
            <p className="import-error-intro">
              没有创建项目。修正下面这些问题后重新导入。
            </p>
            <ul className="import-error-list">
              {importIssues.map((issue, index) => (
                <li key={`${issue.line ?? "file"}-${index}`}>
                  <strong>
                    {issue.line === null ? "文件" : `第 ${issue.line} 行`}
                  </strong>
                  <span>{issue.message}</span>
                </li>
              ))}
            </ul>
            <div className="modal-actions">
              <button className="btn primary" onClick={() => setImportIssues(null)}>
                知道了
              </button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
