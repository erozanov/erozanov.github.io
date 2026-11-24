// \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
let obsidian = require("obsidian");
let child_process = require("child_process");
let path = require("path");
path = __toESM(path);
let fs = require("fs");
fs = __toESM(fs);
// obsidian-plugin/src/main.ts
var DEFAULT_SETTINGS = {
	blogRepoPath: "/Users/erozanov/Projects/travel_blog",
	nodePath: "/opt/homebrew/bin/node",
	autoPush: true
};
var SledomPlugin = class extends obsidian.Plugin {
	constructor(..._args) {
		super(..._args);
		this.settings = DEFAULT_SETTINGS;
	}
	async onload() {
		await this.loadSettings();
		this.addRibbonIcon("compass", "Следом: Опубликовать в блог", () => {
			this.publishCurrentNote();
		});
		this.addCommand({
			id: "publish-active-note",
			name: "Опубликовать / обновить активную заметку в блоге",
			checkCallback: (checking) => {
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile && activeFile.extension === "md") {
					if (!checking) this.publishCurrentNote();
					return true;
				}
				return false;
			}
		});
		this.addCommand({
			id: "create-trip-template",
			name: "Вставить шаблон новой поездки (mode: trip)",
			editorCallback: (editor) => {
				const template = `---
mode: trip
status: готово
id: new-trip
title: Название поездки
country: Страна
number: "005"
startDate: ${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}
endDate: ${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}
summary: "Краткое описание поездки для карточки архива."
cover: cover.jpg
coverAlt: "Описание обложки"
featured: false
---

Здесь вступительный текст поездки, который появится в начале страницы.

\`\`\`cities
Город 1 | city-1 | 0.0 | 0.0 | Короткий тэглайн города | city1.jpg | Фото города
Город 2 | city-2 | 0.0 | 0.0 | Короткий тэглайн города | city2.jpg | Фото города
\`\`\`
`;
				editor.replaceSelection(template);
			}
		});
		this.addSettingTab(new SledomSettingTab(this.app, this));
	}
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}
	async saveSettings() {
		await this.saveData(this.settings);
	}
	getAbsoluteFilePath(file) {
		const adapter = this.app.vault.adapter;
		if (adapter.getBasePath) return path.join(adapter.getBasePath(), file.path);
		return file.path;
	}
	findNodeBinary() {
		if (this.settings.nodePath && fs.existsSync(this.settings.nodePath)) return this.settings.nodePath;
		for (const cand of [
			"/opt/homebrew/bin/node",
			"/usr/local/bin/node",
			"/usr/bin/node"
		]) if (fs.existsSync(cand)) return cand;
		return "node";
	}
	async publishCurrentNote() {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new obsidian.Notice("Откройте заметку для публикации.");
			return;
		}
		const noteFullPath = this.getAbsoluteFilePath(activeFile);
		const scriptPath = path.join(this.settings.blogRepoPath, "scripts", "publish-note.mjs");
		if (!fs.existsSync(this.settings.blogRepoPath)) {
			new obsidian.Notice(`Папка репозитория блога не найдена: ${this.settings.blogRepoPath}`);
			return;
		}
		if (!fs.existsSync(scriptPath)) {
			new obsidian.Notice(`Скрипт публикации не найден: ${scriptPath}`);
			return;
		}
		let content = await this.app.vault.read(activeFile);
		const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
		if (!fmMatch) {
			new obsidian.Notice("У заметки нет блока frontmatter (--- ... ---).");
			return;
		}
		const fm = fmMatch[1];
		const isTrip = /^mode:\s*trip/m.test(fm);
		const isReady = /^status:\s*готово/m.test(fm);
		if (/^status:\s*опубликовано/m.test(fm)) {
			new ConfirmUpdateModal(this.app, isTrip ? "поездку" : "момент", async () => {
				const updated = content.replace(/^status:\s*опубликовано/m, "status: готово");
				await this.app.vault.modify(activeFile, updated);
				this.runPublishProcess(activeFile, noteFullPath, scriptPath);
			}).open();
			return;
		}
		if (!isReady) {
			new ConfirmPublishModal(this.app, isTrip ? "поездку" : "момент", async () => {
				let updated = content;
				if (/^status:/m.test(updated)) updated = updated.replace(/^status:\s*.*$/m, "status: готово");
				else updated = updated.replace(/^---\n/, "---\nstatus: готово\n");
				await this.app.vault.modify(activeFile, updated);
				this.runPublishProcess(activeFile, noteFullPath, scriptPath);
			}).open();
			return;
		}
		this.runPublishProcess(activeFile, noteFullPath, scriptPath);
	}
	runPublishProcess(file, noteFullPath, scriptPath) {
		const nodeBin = this.findNodeBinary();
		const notice = new obsidian.Notice("⏳ Публикуем в блог...", 0);
		const args = [scriptPath, noteFullPath];
		if (!this.settings.autoPush) args.push("--no-push");
		const env = {
			...process.env,
			PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ""}`
		};
		(0, child_process.execFile)(nodeBin, args, {
			env,
			cwd: this.settings.blogRepoPath
		}, (error, stdout, stderr) => {
			notice.hide();
			if (error) {
				console.error("Ошибка публикации:", stderr || stdout || error.message);
				new OutputModal(this.app, "Ошибка при публикации", stderr || stdout || error.message, false).open();
				return;
			}
			console.log("Публикация завершена:", stdout);
			new OutputModal(this.app, "Успешно опубликовано!", stdout, true).open();
		});
	}
};
var ConfirmUpdateModal = class extends obsidian.Modal {
	constructor(app, entityType, onConfirm) {
		super(app);
		this.entityType = entityType;
		this.onConfirm = onConfirm;
	}
	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: `Обновить ${this.entityType}?` });
		contentEl.createEl("p", { text: `Эта заметка уже была опубликована. При обновлении скрипт заново обработает файлы и загрузит обновлённые данные на сайт.` });
		const btnContainer = contentEl.createDiv({ cls: "sledom-buttons" });
		btnContainer.createEl("button", { text: "Отмена" }).addEventListener("click", () => this.close());
		const okBtn = btnContainer.createEl("button", {
			text: "Обновить на сайте",
			cls: "mod-cta"
		});
		okBtn.style.marginLeft = "8px";
		okBtn.addEventListener("click", () => {
			this.close();
			this.onConfirm();
		});
	}
	onClose() {
		this.contentEl.empty();
	}
};
var ConfirmPublishModal = class extends obsidian.Modal {
	constructor(app, entityType, onConfirm) {
		super(app);
		this.entityType = entityType;
		this.onConfirm = onConfirm;
	}
	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: `Опубликовать ${this.entityType}?` });
		contentEl.createEl("p", { text: `В заметке статус ещё не был помечен как «готово». Установить «status: готово» и отправить на сайт?` });
		const btnContainer = contentEl.createDiv({ cls: "sledom-buttons" });
		btnContainer.createEl("button", { text: "Отмена" }).addEventListener("click", () => this.close());
		const okBtn = btnContainer.createEl("button", {
			text: "Опубликовать",
			cls: "mod-cta"
		});
		okBtn.style.marginLeft = "8px";
		okBtn.addEventListener("click", () => {
			this.close();
			this.onConfirm();
		});
	}
	onClose() {
		this.contentEl.empty();
	}
};
var OutputModal = class extends obsidian.Modal {
	constructor(app, titleText, logText, isSuccess) {
		super(app);
		this.titleText = titleText;
		this.logText = logText;
		this.isSuccess = isSuccess;
	}
	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		const h = contentEl.createEl("h2", { text: this.titleText });
		if (!this.isSuccess) h.style.color = "var(--text-error)";
		const pre = contentEl.createEl("pre");
		pre.style.whiteSpace = "pre-wrap";
		pre.style.maxHeight = "300px";
		pre.style.overflowY = "auto";
		pre.style.padding = "10px";
		pre.style.background = "var(--background-secondary)";
		pre.style.borderRadius = "6px";
		pre.style.fontSize = "0.85em";
		pre.setText(this.logText.trim());
		const urlMatch = this.logText.match(/https:\/\/erozanov\.github\.io[^\s]+/);
		if (urlMatch) {
			const p = contentEl.createEl("p");
			p.createSpan({ text: "Ссылка: " });
			const a = p.createEl("a", {
				text: urlMatch[0],
				href: urlMatch[0]
			});
			a.style.wordBreak = "break-all";
		}
		contentEl.createDiv({ cls: "sledom-buttons" }).createEl("button", { text: "Закрыть" }).addEventListener("click", () => this.close());
	}
	onClose() {
		this.contentEl.empty();
	}
};
var SledomSettingTab = class extends obsidian.PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}
	display() {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Настройки публикации в блог «Следом»" });
		new obsidian.Setting(containerEl).setName("Путь к репозиторию блога").setDesc("Абсолютный путь к локальной папке проекта travel_blog").addText((text) => text.setPlaceholder("/Users/erozanov/Projects/travel_blog").setValue(this.plugin.settings.blogRepoPath).onChange(async (value) => {
			this.plugin.settings.blogRepoPath = value.trim();
			await this.plugin.saveSettings();
		}));
		new obsidian.Setting(containerEl).setName("Путь к бинарнику Node.js").setDesc("Обычно /opt/homebrew/bin/node (на Apple Silicon Mac) или /usr/local/bin/node").addText((text) => text.setPlaceholder("/opt/homebrew/bin/node").setValue(this.plugin.settings.nodePath).onChange(async (value) => {
			this.plugin.settings.nodePath = value.trim();
			await this.plugin.saveSettings();
		}));
		new obsidian.Setting(containerEl).setName("Автоматический Git Push").setDesc("Коммитить и пушить изменения сразу при публикации (запускает сборку на GitHub Pages)").addToggle((toggle) => toggle.setValue(this.plugin.settings.autoPush).onChange(async (value) => {
			this.plugin.settings.autoPush = value;
			await this.plugin.saveSettings();
		}));
	}
};
module.exports = SledomPlugin;
