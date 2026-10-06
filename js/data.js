/**
 * data.js — 讀取 data/ 資料夾的 JSON（首頁和 Lab 頁共用）
 * 用 import.meta.url 定位，所以不管頁面在哪一層資料夾都能找到 data/
 */
const BASE = new URL('../data/', import.meta.url);

export async function loadJSON(name) {
  const res = await fetch(new URL(name, BASE));
  if (!res.ok) throw new Error(`讀取 data/${name} 失敗（${res.status}）`);
  return res.json();
}

/** 一次讀取多個檔案，回傳 { 檔名(不含 .json): 內容 } */
export async function loadAll(names) {
  const values = await Promise.all(names.map((n) => loadJSON(`${n}.json`)));
  return Object.fromEntries(names.map((n, i) => [n, values[i]]));
}
