use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
struct Settings {
    root: String,
    recent: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        let root = dirs::document_dir()
            .or_else(dirs::home_dir)
            .unwrap_or_else(|| PathBuf::from("."))
            .join("厦与珈");
        Self {
            root: root.to_string_lossy().to_string(),
            recent: Vec::new(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectEntry {
    path: String,
    json: String,
    updated: u64,
    assets: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetData {
    mime: String,
    base64: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompileFile {
    path: String,
    text: Option<String>,
    base64: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompileRequest {
    files: Vec<CompileFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CompileResult {
    success: bool,
    pdf: Option<String>,
    log: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportAsset {
    source: String,
    target_name: String,
}

fn settings_path() -> Result<PathBuf, String> {
    let base = dirs::data_dir().ok_or("找不到应用数据目录")?;
    Ok(base.join("厦与珈").join("settings.json"))
}

fn load_settings() -> Result<Settings, String> {
    let path = settings_path()?;
    if !path.exists() {
        return Ok(Settings::default());
    }
    let text = fs::read_to_string(&path).map_err(|error| format!("读取设置失败：{error}"))?;
    serde_json::from_str(&text).map_err(|error| format!("设置文件格式错误：{error}"))
}

fn save_settings(settings: &Settings) -> Result<(), String> {
    let path = settings_path()?;
    let parent = path.parent().ok_or("设置目录无效")?;
    fs::create_dir_all(parent).map_err(|error| format!("创建设置目录失败：{error}"))?;
    let text = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;
    let temp = parent.join(".settings.json.tmp");
    fs::write(&temp, text).map_err(|error| format!("写入设置失败：{error}"))?;
    fs::rename(&temp, &path).map_err(|error| format!("保存设置失败：{error}"))
}

fn ensure_root(settings: &Settings) -> Result<PathBuf, String> {
    let root = PathBuf::from(&settings.root);
    if settings.root.trim().is_empty() {
        return Err("项目根目录为空".into());
    }
    fs::create_dir_all(&root).map_err(|error| format!("创建项目根目录失败：{error}"))?;
    Ok(root)
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn entry_from_path(path: &Path) -> Result<ProjectEntry, String> {
    let project_file = path.join("project.json");
    if !project_file.is_file() {
        return Err(format!("{} 不是项目文件夹", path.to_string_lossy()));
    }
    let json = fs::read_to_string(&project_file)
        .map_err(|error| format!("读取 project.json 失败：{error}"))?;
    let updated = fs::metadata(&project_file)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_else(now_millis);
    let assets_dir = path.join("assets");
    let mut assets = Vec::new();
    if assets_dir.is_dir() {
        if let Ok(read_dir) = fs::read_dir(&assets_dir) {
            for entry in read_dir.flatten() {
                if entry.path().is_file() {
                    assets.push(entry.file_name().to_string_lossy().to_string());
                }
            }
        }
    }
    assets.sort();
    Ok(ProjectEntry {
        path: path.to_string_lossy().to_string(),
        json,
        updated,
        assets,
    })
}

fn collect_projects(paths: Vec<PathBuf>) -> Result<Vec<ProjectEntry>, String> {
    let mut seen = HashSet::new();
    let mut entries = Vec::new();
    for path in paths {
        let canonical = fs::canonicalize(&path).unwrap_or(path.clone());
        if !seen.insert(canonical.clone()) {
            continue;
        }
        if let Ok(entry) = entry_from_path(&canonical) {
            entries.push(entry);
        }
    }
    entries.sort_by(|left, right| right.updated.cmp(&left.updated));
    Ok(entries)
}

fn project_paths(settings: &Settings) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let root = PathBuf::from(&settings.root);
    if let Ok(read_dir) = fs::read_dir(&root) {
        for entry in read_dir.flatten() {
            let path = entry.path();
            if path.is_dir() && path.join("project.json").is_file() {
                paths.push(path);
            }
        }
    }
    for recent in &settings.recent {
        let path = PathBuf::from(recent);
        if path.is_dir() && path.join("project.json").is_file() {
            paths.push(path);
        }
    }
    paths
}

fn sanitize_folder_name(name: &str) -> String {
    let mut cleaned: String = name
        .chars()
        .map(|character| {
            if character.is_control() || "/\\:*?\"<>|".contains(character) {
                '-'
            } else {
                character
            }
        })
        .collect();
    cleaned = cleaned.trim().trim_end_matches('.').trim().to_string();
    if cleaned.is_empty() {
        cleaned = "未命名项目".into();
    }
    cleaned.chars().take(60).collect()
}

fn unique_path(root: &Path, name: &str) -> PathBuf {
    let base = sanitize_folder_name(name);
    let mut candidate = root.join(&base);
    let mut index = 2;
    while candidate.exists() {
        candidate = root.join(format!("{base} {index}"));
        index += 1;
    }
    candidate
}

fn write_project(path: &Path, json: &str) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(json)
        .map_err(|error| format!("project.json 格式错误：{error}"))?;
    fs::create_dir_all(path).map_err(|error| format!("创建项目目录失败：{error}"))?;
    fs::create_dir_all(path.join("assets")).map_err(|error| format!("创建资源目录失败：{error}"))?;
    let target = path.join("project.json");
    if target.exists() {
        let _ = fs::copy(&target, path.join("project.json.bak"));
    }
    let temp = path.join(".project.json.tmp");
    fs::write(&temp, json).map_err(|error| format!("写入 project.json 失败：{error}"))?;
    fs::rename(&temp, &target).map_err(|error| format!("保存 project.json 失败：{error}"))
}

fn remember_project(path: &Path) -> Result<(), String> {
    let mut settings = load_settings()?;
    let canonical = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let text = canonical.to_string_lossy().to_string();
    settings.recent.retain(|item| item != &text);
    settings.recent.insert(0, text);
    settings.recent.truncate(20);
    save_settings(&settings)
}

fn forget_project(path: &Path) -> Result<(), String> {
    let mut settings = load_settings()?;
    let canonical = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let text = canonical.to_string_lossy().to_string();
    let before = settings.recent.len();
    settings.recent.retain(|item| item != &text);
    if settings.recent.len() != before {
        save_settings(&settings)?;
    }
    Ok(())
}

fn copy_assets(source: &Path, target: &Path) -> Result<(), String> {
    let source_assets = source.join("assets");
    if !source_assets.is_dir() {
        return Ok(());
    }
    let target_assets = target.join("assets");
    fs::create_dir_all(&target_assets).map_err(|error| format!("创建资源目录失败：{error}"))?;
    for entry in fs::read_dir(&source_assets)
        .map_err(|error| format!("读取资源目录失败：{error}"))?
        .flatten()
    {
        let path = entry.path();
        if path.is_file() {
            let target_path = target_assets.join(entry.file_name());
            fs::copy(&path, &target_path).map_err(|error| format!("复制资源失败：{error}"))?;
        }
    }
    Ok(())
}

fn mime_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

fn safe_relative(path: &str) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("文件路径为空".into());
    }
    let candidate = Path::new(path);
    if candidate.is_absolute() {
        return Err(format!("不允许绝对路径：{path}"));
    }
    for component in candidate.components() {
        if !matches!(component, Component::Normal(_)) {
            return Err(format!("不允许的路径：{path}"));
        }
    }
    Ok(candidate.to_path_buf())
}

fn tectonic_path() -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(executable) = std::env::current_exe() {
        if let Some(dir) = executable.parent() {
            candidates.push(dir.join("tectonic"));
            candidates.push(dir.join("tectonic-aarch64-apple-darwin"));
        }
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join("tectonic-aarch64-apple-darwin"),
    );
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("tools")
            .join("tectonic")
            .join("tectonic"),
    );
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| "找不到 Tectonic".to_string())
}

fn bundle_path() -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(executable) = std::env::current_exe() {
        if let Some(dir) = executable.parent() {
            candidates.push(dir.join("..").join("Resources").join("tectonic-bundle"));
            candidates.push(dir.join("tectonic-bundle"));
        }
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("tectonic-bundle"),
    );
    candidates
        .into_iter()
        .find(|path| path.join("SHA256SUM").is_file())
        .ok_or_else(|| "找不到本地 LaTeX 宏包".to_string())
}

fn run_tectonic(workdir: &Path) -> Result<CompileResult, String> {
    let executable = tectonic_path()?;
    let bundle = bundle_path()?;
    let output = Command::new(&executable)
        .arg("--bundle")
        .arg(&bundle)
        .arg("--only-cached")
        .arg("--reruns")
        .arg("0")
        .arg("--outdir")
        .arg("out")
        .arg("--keep-logs")
        .arg("main.tex")
        .current_dir(workdir)
        .output()
        .map_err(|error| format!("启动 Tectonic 失败：{error}"))?;

    let mut log = String::new();
    log.push_str(&String::from_utf8_lossy(&output.stdout));
    log.push_str(&String::from_utf8_lossy(&output.stderr));
    if let Ok(tex_log) = fs::read_to_string(workdir.join("out").join("main.log")) {
        log.push_str(&tex_log);
    }
    if log.chars().count() > 240_000 {
        log = log.chars().take(240_000).collect::<String>();
    }

    let pdf_path = workdir.join("out").join("main.pdf");
    let pdf = if pdf_path.is_file() {
        let bytes = fs::read(&pdf_path).map_err(|error| format!("读取 PDF 失败：{error}"))?;
        Some(base64::engine::general_purpose::STANDARD.encode(bytes))
    } else {
        None
    };
    Ok(CompileResult {
        success: output.status.success() && pdf.is_some(),
        pdf,
        log,
    })
}

fn compile_workdir() -> Result<PathBuf, String> {
    let base = dirs::cache_dir()
        .ok_or("找不到缓存目录")?
        .join("厦与珈")
        .join("compile");
    fs::create_dir_all(&base).map_err(|error| format!("创建编译目录失败：{error}"))?;
    let directory = base.join(format!("{}-{}", std::process::id(), now_millis()));
    fs::create_dir_all(directory.join("out")).map_err(|error| format!("创建编译目录失败：{error}"))?;
    Ok(directory)
}

#[tauri::command]
fn get_settings() -> Result<Settings, String> {
    let mut settings = load_settings()?;
    ensure_root(&settings)?;
    if settings.recent.is_empty() {
        settings.recent = Vec::new();
    }
    Ok(settings)
}

#[tauri::command]
fn set_root(root: String) -> Result<Settings, String> {
    let path = PathBuf::from(&root);
    if !path.is_dir() {
        return Err("项目目录不存在".into());
    }
    let mut settings = load_settings()?;
    settings.root = root;
    save_settings(&settings)?;
    Ok(settings)
}

#[tauri::command]
async fn list_projects() -> Result<Vec<ProjectEntry>, String> {
    let settings = load_settings()?;
    ensure_root(&settings)?;
    collect_projects(project_paths(&settings))
}

#[tauri::command]
async fn load_project(path: String) -> Result<ProjectEntry, String> {
    let entry = entry_from_path(Path::new(&path))?;
    remember_project(Path::new(&path))?;
    Ok(entry)
}

#[tauri::command]
async fn create_project(name: String, json: String) -> Result<ProjectEntry, String> {
    let settings = load_settings()?;
    let root = ensure_root(&settings)?;
    let path = unique_path(&root, &name);
    write_project(&path, &json)?;
    entry_from_path(&path)
}

fn import_project_into_root(
    root: &Path,
    name: &str,
    json: &str,
    base: &Path,
    assets: &[ImportAsset],
) -> Result<PathBuf, String> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("创建导入目录失败：{error}"))?
        .as_nanos();
    let staging = root.join(format!(".import-{}-{}", std::process::id(), stamp));

    let result = (|| -> Result<PathBuf, String> {
        fs::create_dir_all(staging.join("assets"))
            .map_err(|error| format!("创建导入目录失败：{error}"))?;
        let mut targets = HashSet::new();
        for asset in assets {
            let relative = Path::new(&asset.source);
            if relative.is_absolute() {
                return Err("图片路径必须是相对路径".into());
            }
            let source = fs::canonicalize(base.join(relative))
                .map_err(|error| format!("读取图片 {} 失败：{error}", asset.source))?;
            if !source.starts_with(base) || !source.is_file() {
                return Err(format!("图片 {} 不在 Markdown 所在目录内", asset.source));
            }
            let extension = source
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_lowercase();
            if !["png", "jpg", "jpeg"].contains(&extension.as_str()) {
                return Err(format!("图片 {} 的格式不受支持", asset.source));
            }
            let metadata =
                fs::metadata(&source).map_err(|error| format!("读取图片失败：{error}"))?;
            if metadata.len() > 20_000_000 {
                return Err(format!("图片 {} 超过 20MB", asset.source));
            }
            let target = Path::new(&asset.target_name);
            let target_name = target
                .file_name()
                .and_then(|value| value.to_str())
                .ok_or_else(|| "图片目标文件名无效".to_string())?;
            if target_name != asset.target_name || !asset.target_name.starts_with("fig-") {
                return Err("图片目标文件名必须写成 fig-<blockId>.<ext>".into());
            }
            let target_extension = target
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_lowercase();
            if target_extension != extension {
                return Err("图片目标扩展名必须与源文件一致".into());
            }
            if !targets.insert(asset.target_name.clone()) {
                return Err("图片目标文件名重复".into());
            }
            fs::copy(&source, staging.join("assets").join(&asset.target_name))
                .map_err(|error| format!("复制图片失败：{error}"))?;
        }
        write_project(&staging, json)?;
        let path = unique_path(root, name);
        fs::rename(&staging, &path)
            .map_err(|error| format!("完成导入项目失败：{error}"))?;
        Ok(path)
    })();

    match result {
        Ok(path) => Ok(path),
        Err(error) => {
            let _ = fs::remove_dir_all(&staging);
            Err(error)
        }
    }
}

#[tauri::command]
async fn create_project_from_import(
    name: String,
    json: String,
    markdown_path: String,
    assets: Vec<ImportAsset>,
) -> Result<ProjectEntry, String> {
    let settings = load_settings()?;
    let root = ensure_root(&settings)?;
    let markdown = fs::canonicalize(&markdown_path)
        .map_err(|error| format!("读取 Markdown 路径失败：{error}"))?;
    let base = markdown
        .parent()
        .ok_or_else(|| "Markdown 文件没有所在目录".to_string())?
        .to_path_buf();
    let path = import_project_into_root(&root, &name, &json, &base, &assets)?;
    entry_from_path(&path)
}

#[tauri::command]
async fn duplicate_project(source: String, name: String, json: String) -> Result<ProjectEntry, String> {
    let settings = load_settings()?;
    let root = ensure_root(&settings)?;
    let target = unique_path(&root, &name);
    fs::create_dir_all(&target).map_err(|error| format!("创建项目目录失败：{error}"))?;
    copy_assets(Path::new(&source), &target)?;
    write_project(&target, &json)?;
    entry_from_path(&target)
}

#[tauri::command]
async fn save_project(path: String, json: String) -> Result<(), String> {
    write_project(Path::new(&path), &json)
}

#[tauri::command]
async fn delete_project(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !target.join("project.json").is_file() {
        return Err("项目文件夹缺少 project.json".into());
    }
    let settings = load_settings()?;
    let root = fs::canonicalize(&settings.root).unwrap_or_else(|_| PathBuf::from(&settings.root));
    let canonical = fs::canonicalize(&target).unwrap_or_else(|_| target.clone());
    if canonical == root {
        return Err("不能删除项目根目录".into());
    }
    trash::delete(&target).map_err(|error| format!("移入废纸篓失败：{error}"))?;
    forget_project(&target)?;
    Ok(())
}

#[tauri::command]
async fn import_asset(project_path: String, file_name: String, data: String) -> Result<String, String> {
    let assets = Path::new(&project_path).join("assets");
    fs::create_dir_all(&assets).map_err(|error| format!("创建资源目录失败：{error}"))?;
    let raw_name = Path::new(&file_name)
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("图片文件名无效")?;
    let cleaned: String = raw_name
        .chars()
        .map(|character| {
            if character.is_control() || "/\\:*?\"<>|".contains(character) {
                '-'
            } else {
                character
            }
        })
        .collect();
    let cleaned = if cleaned.trim().is_empty() {
        "image.png".to_string()
    } else {
        cleaned
    };
    let source = Path::new(&cleaned);
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("image");
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("png");
    let mut candidate = cleaned.clone();
    let mut index = 2;
    while assets.join(&candidate).exists() {
        candidate = format!("{stem}-{index}.{extension}");
        index += 1;
    }
    let payload = data.rsplit(',').next().unwrap_or(&data);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload)
        .map_err(|error| format!("图片数据无法解码：{error}"))?;
    fs::write(assets.join(&candidate), bytes).map_err(|error| format!("保存图片失败：{error}"))?;
    Ok(candidate)
}

#[tauri::command]
async fn read_asset(project_path: String, src: String) -> Result<AssetData, String> {
    let name = Path::new(&src)
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("资源文件名无效")?;
    let path = Path::new(&project_path).join("assets").join(name);
    let bytes = fs::read(&path).map_err(|error| format!("读取图片失败：{error}"))?;
    Ok(AssetData {
        mime: mime_for(&path).to_string(),
        base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}

#[tauri::command]
async fn read_text_file(path: String) -> Result<String, String> {
    let metadata = fs::metadata(&path).map_err(|error| format!("读取文件失败：{error}"))?;
    if metadata.len() > 5_000_000 {
        return Err("文件超过 5MB".into());
    }
    fs::read_to_string(&path).map_err(|error| format!("读取文件失败：{error}"))
}

#[tauri::command]
async fn save_export(
    default_name: String,
    _filter_name: String,
    _filter_extension: String,
    data: String,
) -> Result<Option<String>, String> {
    let downloads = dirs::download_dir()
        .or_else(|| dirs::home_dir().map(|path| path.join("Downloads")))
        .ok_or("找不到下载目录")?;
    let directory = downloads.join("厦与珈导出");
    fs::create_dir_all(&directory).map_err(|error| format!("创建导出目录失败：{error}"))?;
    let cleaned: String = default_name
        .chars()
        .map(|character| {
            if character.is_control() || "/\\:*?\"<>|".contains(character) {
                '-'
            } else {
                character
            }
        })
        .collect();
    let cleaned = if cleaned.trim().is_empty() {
        "导出文件".to_string()
    } else {
        cleaned
    };
    let source = Path::new(&cleaned);
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("导出文件");
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    let mut name = cleaned.clone();
    let mut index = 2;
    while directory.join(&name).exists() {
        name = if extension.is_empty() {
            format!("{stem}-{index}")
        } else {
            format!("{stem}-{index}.{extension}")
        };
        index += 1;
    }
    let path = directory.join(&name);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|error| format!("导出数据无法解码：{error}"))?;
    fs::write(&path, bytes).map_err(|error| format!("写入导出文件失败：{error}"))?;
    Ok(Some(path.to_string_lossy().to_string()))
}

#[tauri::command]
async fn compile(request: CompileRequest) -> Result<CompileResult, String> {
    tauri::async_runtime::spawn_blocking(move || compile_blocking(request))
        .await
        .map_err(|error| format!("编译任务失败：{error}"))?
}

static COMPILE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn compile_blocking(request: CompileRequest) -> Result<CompileResult, String> {
    let _guard = COMPILE_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let workdir = compile_workdir()?;
    let write_result = (|| -> Result<(), String> {
        for file in &request.files {
            let relative = safe_relative(&file.path)?;
            let target = workdir.join(relative);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("创建编译文件目录失败：{error}"))?;
            }
            match (&file.text, &file.base64) {
                (Some(text), None) => {
                    fs::write(&target, text)
                        .map_err(|error| format!("写入编译文件失败：{error}"))?;
                }
                (None, Some(data)) => {
                    let payload = data.rsplit(',').next().unwrap_or(data);
                    let bytes = base64::engine::general_purpose::STANDARD
                        .decode(payload)
                        .map_err(|error| format!("编译资源无法解码：{error}"))?;
                    fs::write(&target, bytes)
                        .map_err(|error| format!("写入编译资源失败：{error}"))?;
                }
                _ => return Err(format!("编译文件 {} 的内容无效", file.path)),
            }
        }
        Ok(())
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_dir_all(&workdir);
        return Err(error);
    }
    let result = run_tectonic(&workdir);
    let _ = fs::remove_dir_all(&workdir);
    result
}

#[tauri::command]
async fn compile_folder(path: String) -> Result<CompileResult, String> {
    tauri::async_runtime::spawn_blocking(move || compile_folder_blocking(path))
        .await
        .map_err(|error| format!("编译任务失败：{error}"))?
}

fn compile_folder_blocking(path: String) -> Result<CompileResult, String> {
    let _guard = COMPILE_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let source = PathBuf::from(&path);
    if !source.join("main.tex").is_file() {
        return Err("选择的文件夹缺少 main.tex".into());
    }
    let workdir = compile_workdir()?;
    let copy_result = (|| -> Result<(), String> {
        copy_tree(&source, &workdir)?;
        Ok(())
    })();
    if let Err(error) = copy_result {
        let _ = fs::remove_dir_all(&workdir);
        return Err(error);
    }
    let result = run_tectonic(&workdir);
    let _ = fs::remove_dir_all(&workdir);
    result
}

fn copy_tree(source: &Path, target: &Path) -> Result<(), String> {
    for entry in fs::read_dir(source)
        .map_err(|error| format!("读取工程目录失败：{error}"))?
        .flatten()
    {
        let path = entry.path();
        let name = entry.file_name();
        let name_text = name.to_string_lossy();
        if name_text == ".build" || name_text == "out" || name_text == ".DS_Store" {
            continue;
        }
        let destination = target.join(&name);
        if path.is_dir() {
            fs::create_dir_all(&destination)
                .map_err(|error| format!("创建工程目录失败：{error}"))?;
            copy_tree(&path, &destination)?;
        } else {
            fs::copy(&path, &destination).map_err(|error| format!("复制工程文件失败：{error}"))?;
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_settings,
            set_root,
            list_projects,
            load_project,
            create_project,
            create_project_from_import,
            duplicate_project,
            save_project,
            delete_project,
            import_asset,
            read_asset,
            read_text_file,
            save_export,
            compile,
            compile_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running 厦与珈");
}

#[cfg(test)]
mod import_tests {
    use super::*;

    fn temp_path(label: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("xyj-{label}-{}-{stamp}", std::process::id()))
    }

    #[test]
    fn imports_local_assets_and_rejects_outside_paths() {
        let parent = temp_path("case");
        let root = parent.join("root");
        let base = parent.join("base");
        fs::create_dir_all(base.join("images")).unwrap();
        fs::write(base.join("images/a.png"), b"test image").unwrap();
        let outside = parent.join("outside.png");
        fs::write(&outside, b"outside").unwrap();
        let canonical_base = fs::canonicalize(&base).unwrap();

        let assets = vec![
            ImportAsset {
                source: "images/a.png".into(),
                target_name: "fig-block-1.png".into(),
            },
            ImportAsset {
                source: "../outside.png".into(),
                target_name: "fig-block-2.png".into(),
            },
        ];
        let error =
            import_project_into_root(&root, "测试项目", "{}", &canonical_base, &assets)
                .unwrap_err();
        assert!(error.contains("不在 Markdown 所在目录内"));
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);

        let assets = vec![ImportAsset {
            source: "images/a.png".into(),
            target_name: "fig-block-1.png".into(),
        }];
        let path =
            import_project_into_root(&root, "测试项目", "{}", &canonical_base, &assets)
                .unwrap();
        assert!(path.join("project.json").is_file());
        assert!(path.join("assets/fig-block-1.png").is_file());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);

        let _ = fs::remove_dir_all(&parent);
    }
}
