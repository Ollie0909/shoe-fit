/**
 * store.js — 記住使用者上次輸入的腳型資料（只存在使用者自己的瀏覽器，不會上傳）
 * 首頁和 Lab 頁共用，所以在一邊輸入過，另一邊會自動帶入。
 */
const KEY = 'fit-atelier.profile.v1';

export function loadProfile() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

export function saveProfile(patch) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadProfile(), ...patch }));
  } catch {
    // 無痕模式等情況無法儲存，不影響使用
  }
}
