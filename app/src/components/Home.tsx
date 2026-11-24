import { useState } from "react";
import type { Project, ThemeId } from "../types";
import { PALETTES, themeLabel, themeVars } from "../lib/palettes";
import { plainText } from "../lib/text";
import { Icon } from "./Icons";

export interface ProjectCardData {
  path: string;
  project: Project;
  updated: number;
}

interface HomeProps {
  projects: ProjectCardData[];
  onOpen: (path: string) => void;
  onCreate: (name: string, theme: ThemeId) => void;
  onDuplicate: (path: string) => void;
  onDelete: (path: string) => void;
  onRename: (path: string, name: string) => void;
  onOpenFolder: () => void;
  onChooseRoot: () => void;
  onImportMarkdown: () => void;
  importingMarkdown: boolean;
}

function formatUpdated(timestamp: number): string {
  const difference = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(difference / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function Home({
  projects,
  onOpen,
  onCreate,
  onDuplicate,
  onDelete,
  onRename,
  onOpenFolder,
  onChooseRoot,
  onImportMarkdown,
  importingMarkdown,
}: HomeProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [theme, setTheme] = useState<ThemeId>("whu");
  const [renameModal, setRenameModal] = useState<{ path: string; value: string } | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<{ path: string; name: string } | null>(
    null,
  );

  const submit = () => {
    if (!name.trim()) return;
    onCreate(name.trim(), theme);
    setName("");
    setTheme("whu");
    setModalOpen(false);
  };

  return (
    <div className="home">
      <header className="home-top">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
          </span>
          <h1>厦与珈</h1>
        </div>
        <div className="home-actions">
          <button className="btn ghost" onClick={onOpenFolder}>
            <Icon name="folder" />
            打开文件夹
          </button>
          <button
            className="btn ghost"
            onClick={onImportMarkdown}
            disabled={importingMarkdown}
            title="选择符合结构化 Markdown 规范的文件"
          >
            <Icon name="document" />
            {importingMarkdown ? "导入中" : "从 Markdown 新建"}
          </button>
          <button className="btn primary" onClick={() => setModalOpen(true)}>
            <Icon name="plus" />
            新建项目
          </button>
        </div>
      </header>

      <main className="home-main">
        <div className="section-head">
          <h2>最近项目</h2>
          <span className="count">{projects.length}</span>
        </div>

        {projects.length === 0 ? (
          <button className="empty-card" onClick={() => setModalOpen(true)}>
            <Icon name="plus" size={20} />
            <span>新建项目</span>
          </button>
        ) : (
          <div className="project-grid">
            {projects.map(({ path, project, updated }) => (
              <article
                key={path}
                className="project-card"
                style={themeVars(project.theme)}
                onClick={() => onOpen(path)}
              >
                <div className="thumb">
                  <div className="thumb-band" />
                  <div className="thumb-slide">
                    <div className="thumb-kicker" />
                    <div className="thumb-title">{plainText(project.cover.title)}</div>
                    <div className="thumb-line" style={{ width: "66%" }} />
                    <div className="thumb-line" style={{ width: "44%" }} />
                  </div>
                  <span className="thumb-dot" />
                </div>
                <div className="card-info">
                  <div className="card-name">{project.name}</div>
                  <div className="card-meta">
                    <i className="theme-dot" />
                    {themeLabel[project.theme]} · {formatUpdated(updated)}
                  </div>
                </div>
                <div className="card-actions" onClick={(event) => event.stopPropagation()}>
                  <button
                    title="重命名项目"
                    onClick={() => setRenameModal({ path, value: project.name })}
                  >
                    <Icon name="edit" size={14} />
                  </button>
                  <button title="复制项目" onClick={() => onDuplicate(path)}>
                    <Icon name="copy" size={14} />
                  </button>
                  <button
                    title="删除项目"
                    onClick={() => setDeleteTarget({ path, name: project.name })}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>

      <footer className="home-foot">
        <span>本地项目 · {projects.length}</span>
        <button className="foot-link" onClick={onChooseRoot}>
          项目目录
        </button>
      </footer>

      {modalOpen && (
        <div className="modal-overlay" onMouseDown={() => setModalOpen(false)}>
          <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>新建项目</h3>
              <button className="icon-btn" onClick={() => setModalOpen(false)} aria-label="关闭">
                <Icon name="close" />
              </button>
            </div>

            <label className="field-label" htmlFor="project-name">
              项目名
            </label>
            <input
              id="project-name"
              className="input modal-input"
              autoFocus
              value={name}
              placeholder="例如：我的幻灯片"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submit();
              }}
            />

            <label className="field-label">主题</label>
            <div className="theme-options">
              {PALETTES.map((item) => (
                <button
                  key={item.id}
                  className={`theme-option ${theme === item.id ? "active" : ""}`}
                  style={themeVars(item.id)}
                  onClick={() => setTheme(item.id)}
                >
                  <span className="theme-option-swatch" />
                  <span>{item.name}</span>
                  {theme === item.id && <Icon name="check" size={14} />}
                </button>
              ))}
            </div>

            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setModalOpen(false)}>
                取消
              </button>
              <button className="btn primary" onClick={submit} disabled={!name.trim()}>
                新建
              </button>
            </div>
          </div>
        </div>
      )}

      {renameModal && (
        <div className="modal-overlay" onMouseDown={() => setRenameModal(null)}>
          <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>重命名项目</h3>
              <button
                className="icon-btn"
                onClick={() => setRenameModal(null)}
                aria-label="关闭"
              >
                <Icon name="close" />
              </button>
            </div>
            <label className="field-label" htmlFor="rename-project">
              项目名
            </label>
            <input
              id="rename-project"
              className="input modal-input"
              autoFocus
              value={renameModal.value}
              onChange={(event) =>
                setRenameModal({ ...renameModal, value: event.target.value })
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" && renameModal.value.trim()) {
                  onRename(renameModal.path, renameModal.value);
                  setRenameModal(null);
                }
              }}
            />
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setRenameModal(null)}>
                取消
              </button>
              <button
                className="btn primary"
                disabled={!renameModal.value.trim()}
                onClick={() => {
                  onRename(renameModal.path, renameModal.value);
                  setRenameModal(null);
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-overlay" onMouseDown={() => setDeleteTarget(null)}>
          <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>删除项目</h3>
              <button
                className="icon-btn"
                onClick={() => setDeleteTarget(null)}
                aria-label="关闭"
              >
                <Icon name="close" />
              </button>
            </div>
            <p className="modal-text">
              项目“{deleteTarget.name}”会移入废纸篓。
            </p>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setDeleteTarget(null)}>
                取消
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  onDelete(deleteTarget.path);
                  setDeleteTarget(null);
                }}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
