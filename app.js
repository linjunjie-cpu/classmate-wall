/* ============================================================
 * 班级名片墙 · 主逻辑 v2
 * 功能：名片墙 / 填写 / 标签筛选 / 随机认识 / 个人打卡 /
 *       分享二维码 / 本人修改删除 / 管理员管理（含未填名单）
 * ============================================================ */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG || {};
  var PAGE = CFG.page || {};
  var SB = CFG.supabase || {};
  var DEMO = CFG.demo || {};

  var DEMO_DATA_KEY = 'classwall_demo_v1';
  var KNOWN_KEY = 'classwall_known_v1';
  var MYCARD_KEY = 'classwall_mycard_v1';
  var ROSTER_KEY = 'classwall_roster_v1';
  var DEMO_ADMIN = DEMO.adminPassword || 'admin123';

  var state = { list: [], query: '', known: {} };
  var avatarDataUrl = '';       // 新提交表单的头像
  var editAvatarDataUrl = '';   // 编辑时新选的头像
  var editRemoveAvatar = false;
  var avatarEmoji = '';          // 填写表单：选中的 emoji 头像
  var editEmoji = '';            // 编辑弹窗：选中的 emoji 头像
  var editDefaultAvatar = false; // 编辑弹窗：是否用默认（名字首字）头像
  var adminSecret = '';         // 本次会话的管理员密码（supabase 模式）
  var adminAuthed = false;
  var editCtx = null;             // 编辑弹窗上下文：{mode, id, code, rec, fromAdmin}

  /* ---------- 小工具 ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function esc(s) { return String(s == null ? '' : s); }
  function toast(msg, isError) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('error', !!isError);
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, 3400);
  }
  function genId() { return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
  function hashColor(str) {
    var pal = ['#0E3E96', '#1558C2', '#1E6FB5', '#1D7FD1', '#0F766E',
               '#0D9488', '#B45309', '#BE185D', '#3730A3', '#334155'];
    var h = 0;
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return pal[h % pal.length];
  }
  function splitTags(s) {
    return esc(s).split(/[,，、;；\s]+/).map(function (t) { return t.trim(); }).filter(Boolean);
  }
  function displayName(r) {
    var n = (r.nickname || '').trim();
    return n || (r.name || '').trim();
  }
  function realNameLine(r) {
    var nick = (r.nickname || '').trim();
    var name = (r.name || '').trim();
    if (nick && nick !== name) return '本名 ' + name;
    return '';
  }
  function norm(s) { return esc(s).trim().replace(/\s+/g, ' '); }

  /* ---------- 修改码 ---------- */
  function genCode() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    var out = '';
    if (window.crypto && window.crypto.getRandomValues) {
      var a = new Uint32Array(8);
      window.crypto.getRandomValues(a);
      for (var i = 0; i < a.length; i++) out += chars[a[i] % chars.length];
    } else {
      for (var j = 0; j < 8; j++) out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
  }
  // 修改码 -> 哈希（存入数据库的是哈希，数据库对同学隐藏该列）
  function hashCode(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return h.toString(16);
  }

  /* ---------- 本地存储（打卡/我的名片/演示数据/演示名单） ---------- */
  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function writeJson(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { toast('本地保存失败（可能图片过大）', true); return false; }
  }

  function seedDemo() {
    return (CFG.demoData || []).map(function (r) {
      return Object.assign({}, r, {
        id: genId(), created_at: new Date().toISOString(), edit_code: genCode()
      });
    });
  }
  function demoRead() {
    var arr = readJson(DEMO_DATA_KEY, null);
    if (!arr) { arr = seedDemo(); writeJson(DEMO_DATA_KEY, arr); return arr; }
    // 兼容旧数据：补上缺失的修改码
    var changed = false;
    arr.forEach(function (r) { if (!r.edit_code) { r.edit_code = genCode(); changed = true; } });
    if (changed) writeJson(DEMO_DATA_KEY, arr);
    return arr;
  }
  function demoWrite(arr) { return writeJson(DEMO_DATA_KEY, arr); }

  function isSupabase() { return CFG.mode === 'supabase'; }

  /* ---------- 个人打卡 ---------- */
  function knownRead() { state.known = readJson(KNOWN_KEY, {}) || {}; return state.known; }
  function knownWrite() { writeJson(KNOWN_KEY, state.known); }
  function knownCount() {
    var n = 0;
    for (var i = 0; i < state.list.length; i++) if (state.known[state.list[i].id]) n++;
    return n;
  }
  function isKnown(id) { return !!state.known[id]; }
  function toggleKnown(id) {
    if (state.known[id]) delete state.known[id]; else state.known[id] = true;
    knownWrite();
    updateKnownPill();
  }

  /* ---------- “我的名片”记录 ---------- */
  function readMyCard() { return readJson(MYCARD_KEY, null); }
  function writeMyCard(c) { writeJson(MYCARD_KEY, c); }
  function clearMyCard() { try { localStorage.removeItem(MYCARD_KEY); } catch (e) {} }
  /* ============================================================
   * 数据层：Supabase（正式）与 localStorage（演示）双实现
   * ============================================================ */
  function sbHeaders() {
    return { apikey: SB.anonKey, Authorization: 'Bearer ' + SB.anonKey };
  }
  function sbUrl(path) { return SB.url.replace(/\/+$/, '') + path; }
  function sbCheckConfig() {
    if (!SB.url || !SB.anonKey) {
      toast('还没配置 Supabase：请打开 js/config.js 填写 url 和 anonKey（见 README）', true);
      return false;
    }
    return true;
  }
  function sbRpc(name, args) {
    return fetch(sbUrl('/rest/v1/rpc/' + name), {
      method: 'POST',
      headers: Object.assign(sbHeaders(), { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
      body: JSON.stringify(args || {})
    }).then(function (res) {
      if (!res.ok) throw new Error(name + ' 失败（' + res.status + '）');
      return res.json();
    });
  }
  function dataUrlToBlob(dataUrl) {
    var parts = dataUrl.split(',');
    var m = /data:(.*?);/.exec(parts[0]);
    var mime = (m && m[1]) || 'image/jpeg';
    var bin = atob(parts[1]);
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: mime });
  }
  function uploadAvatar(dataUrl) {
    var file = 'avatar-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.jpg';
    return fetch(sbUrl('/storage/v1/object/' + SB.avatarBucket + '/' + file), {
      method: 'POST',
      headers: Object.assign(sbHeaders(), { 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }),
      body: dataUrlToBlob(dataUrl)
    }).then(function (res) {
      if (!res.ok) throw new Error('上传失败（' + res.status + '）');
      return sbUrl('/storage/v1/object/public/' + SB.avatarBucket + '/' + file);
    });
  }

  /* ---------- 读取名单 ---------- */
  function loadList() {
    if (isSupabase()) {
      if (!sbCheckConfig()) return Promise.resolve([]);
      return fetch(sbUrl('/rest/v1/' + SB.table + '?select=*&order=created_at.desc'), { headers: sbHeaders() })
        .then(function (res) {
          if (!res.ok) throw new Error('读取失败（' + res.status + '）');
          return res.json();
        })
        .catch(function (e) { toast('加载失败：' + e.message, true); return []; });
    }
    return Promise.resolve(demoRead());
  }

  /* ---------- 提交 ---------- */
  function addRecord(payload, avatar, emoji) {
    if (isSupabase()) return sbAddRecord(payload, avatar, emoji);
    return new Promise(function (resolve, reject) {
      try {
        var arr = demoRead();
        var code = genCode();
        var rec = Object.assign({}, payload, {
          id: genId(), avatar: avatar || '', avatarEmoji: emoji || '',
          created_at: new Date().toISOString(), edit_code: code
        });
        arr.unshift(rec);
        demoWrite(arr);
        resolve({ record: rec, code: code });
      } catch (e) { reject(e); }
    });
  }
  function sbAddRecord(payload, avatar, emoji) {
    if (!sbCheckConfig()) return Promise.reject(new Error('未配置 Supabase'));
    var code = genCode();
    var body = {
      name: payload.name, nickname: payload.nickname || '', hometown: payload.hometown || '',
      interests: payload.interests || '', intro: payload.intro || '',
      contact: payload.contact || '', avatar_url: '', avatar_emoji: emoji || '',
      mbti: payload.mbti || '', catchphrase: payload.catchphrase || '', hidden_skill: payload.hiddenSkill || '',
      edit_key: hashCode(code)
    };
    function doInsert() {
      return fetch(sbUrl('/rest/v1/' + SB.table), {
        method: 'POST',
        headers: Object.assign(sbHeaders(), { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
        body: JSON.stringify(body)
      }).then(function (res) {
        if (!res.ok) throw new Error('提交失败（' + res.status + '）');
        return res.json();
      }).then(function (rows) {
        var rec = (rows && rows[0]) || Object.assign({}, body, { id: genId() });
        return { record: rec, code: code };
      });
    }
    if (!avatar) return doInsert();
    return uploadAvatar(avatar).then(function (url) {
      body.avatar_url = url;
      return doInsert();
    }).catch(function (e) {
      toast('头像上传失败（已改用文字头像）：' + e.message, true);
      body.avatar_url = '';
      return doInsert();
    });
  }

  /* ---------- 本人修改 / 删除 ---------- */
  function updateMy(id, code, fields, avatar) {
    if (isSupabase()) return sbUpdateMy(id, code, fields, avatar);
    return new Promise(function (resolve) {
      var arr = demoRead();
      var rec = null;
      for (var i = 0; i < arr.length; i++) if (arr[i].id === id) { rec = arr[i]; break; }
      if (!rec || rec.edit_code !== code) return resolve(false);
      rec.nickname = fields.nickname;
      rec.hometown = fields.hometown;
      rec.interests = fields.interests;
      rec.intro = fields.intro;
      rec.contact = fields.contact;
      rec.mbti = fields.mbti || '';
      rec.catchphrase = fields.catchphrase || '';
      rec.hiddenSkill = fields.hiddenSkill || '';
      if (avatar) {
        if (avatar.photo) rec.avatar = avatar.photo;
        else if (avatar.photoRemove) rec.avatar = '';
        if (avatar.emoji) rec.avatarEmoji = avatar.emoji;
        else if (avatar.emojiRemove) rec.avatarEmoji = '';
      }
      demoWrite(arr);
      resolve(true);
    });
  }
  function sbUpdateMy(id, code, fields, avatar) {
    if (!sbCheckConfig()) return Promise.resolve(false);
    var p = {
      p_id: id, p_key: hashCode(code),
      p_nickname: fields.nickname, p_hometown: fields.hometown,
      p_interests: fields.interests, p_intro: fields.intro, p_contact: fields.contact,
      p_mbti: fields.mbti || '', p_catchphrase: fields.catchphrase || '',
      p_hidden_skill: fields.hiddenSkill || '',
      p_avatar_url: null, p_avatar_emoji: null
    };
    function go() { return sbRpc('update_my_card', p); }
    if (!avatar) return go();
    if (avatar.emoji) p.p_avatar_emoji = avatar.emoji;
    else if (avatar.emojiRemove) p.p_avatar_emoji = '';
    if (avatar.photo) {
      return uploadAvatar(avatar.photo).then(function (url) {
        p.p_avatar_url = url;
        return go();
      }).catch(function (e) {
        toast('新头像上传失败（其余修改仍会保存）：' + e.message, true);
        p.p_avatar_url = null;
        return go();
      });
    }
    if (avatar.photoRemove) p.p_avatar_url = '';
    return go();
  }
  function deleteMy(id, code) {
    if (isSupabase()) {
      if (!sbCheckConfig()) return Promise.resolve(false);
      return sbRpc('delete_my_card', { p_id: id, p_key: hashCode(code) });
    }
    return new Promise(function (resolve) {
      var arr = demoRead();
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].id === id) {
          if (arr[i].edit_code !== code) return resolve(false);
          arr.splice(i, 1);
          demoWrite(arr);
          return resolve(true);
        }
      }
      resolve(false);
    });
  }

  /* ---------- 班级名单（demo 存本地 / supabase 走安全函数） ---------- */
  function demoRosterRead() {
    var arr = readJson(ROSTER_KEY, null);
    if (!arr) { arr = (DEMO.roster || []).slice(); writeJson(ROSTER_KEY, arr); }
    return arr;
  }
  function rosterGet(secret) {
    if (isSupabase()) {
      if (!sbCheckConfig()) return Promise.resolve([]);
      return sbRpc('admin_roster_get', { p_secret: secret }).catch(function () { return []; });
    }
    return Promise.resolve(secret === DEMO_ADMIN ? demoRosterRead() : []);
  }
  function rosterSet(secret, names) {
    if (isSupabase()) {
      if (!sbCheckConfig()) return Promise.resolve(-1);
      return sbRpc('admin_roster_set', { p_secret: secret, p_names: names });
    }
    if (secret !== DEMO_ADMIN) return Promise.resolve(-1);
    writeJson(ROSTER_KEY, names);
    return Promise.resolve(names.length);
  }

  /* ---------- 管理员 ---------- */
  function adminCheck(secret) {
    if (isSupabase()) {
      if (!sbCheckConfig()) return Promise.resolve(false);
      return sbRpc('admin_check', { p_secret: secret }).catch(function () { return false; });
    }
    return Promise.resolve(secret === DEMO_ADMIN);
  }
  function adminUpdate(id, secret, fields) {
    if (isSupabase()) {
      if (!sbCheckConfig()) return Promise.resolve(false);
      return sbRpc('admin_update_card', {
        p_id: id, p_secret: secret, p_name: fields.name, p_nickname: fields.nickname,
        p_hometown: fields.hometown, p_interests: fields.interests,
        p_intro: fields.intro, p_contact: fields.contact,
        p_mbti: fields.mbti || '', p_catchphrase: fields.catchphrase || '',
        p_hidden_skill: fields.hiddenSkill || ''
      });
    }
    return new Promise(function (resolve) {
      var arr = demoRead();
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].id === id) {
          arr[i].name = fields.name;
          arr[i].nickname = fields.nickname;
          arr[i].hometown = fields.hometown;
          arr[i].interests = fields.interests;
          arr[i].intro = fields.intro;
          arr[i].contact = fields.contact;
          arr[i].mbti = fields.mbti || '';
          arr[i].catchphrase = fields.catchphrase || '';
          arr[i].hiddenSkill = fields.hiddenSkill || '';
          demoWrite(arr);
          return resolve(true);
        }
      }
      resolve(false);
    });
  }
  function adminDelete(id, secret) {
    if (isSupabase()) {
      if (!sbCheckConfig()) return Promise.resolve(false);
      return sbRpc('admin_delete_card', { p_id: id, p_secret: secret });
    }
    return new Promise(function (resolve) {
      if (secret !== DEMO_ADMIN) return resolve(false);
      var arr = demoRead();
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].id === id) { arr.splice(i, 1); demoWrite(arr); return resolve(true); }
      }
      resolve(false);
    });
  }
  function adminSetSecret(oldS, newS) {
    if (isSupabase()) {
      if (!sbCheckConfig()) return Promise.resolve(false);
      return sbRpc('admin_set_secret', { p_old: oldS, p_new: newS });
    }
    return Promise.resolve(false); // 演示模式不允许改密码
  }
  /* ---------- emoji 头像选择 ---------- */
  var EMOJIS = ['😀','😎','🥰','🤓','🐶','🐱','🦊','🐼','🦁','🐸','🦄','🐙','🦋','🌻','🌈','🍀','⚽','🎧','🎮','🎸','📚','🎨','✈️','🚴','🏀','🍜','☕','🌙','👾'];
  function buildEmojiGrid(containerId, onPick) {
    var grid = $('#' + containerId);
    if (!grid) return;
    grid.innerHTML = '';
    EMOJIS.forEach(function (e) {
      var b = el('button', 'emoji-opt', e);
      b.setAttribute('type', 'button');
      b.setAttribute('data-e', e);
      b.title = e;
      b.addEventListener('click', function () { onPick(e); });
      grid.appendChild(b);
    });
  }
  function markEmojiSel(containerId, chosen) {
    var grid = $('#' + containerId);
    if (!grid) return;
    Array.prototype.forEach.call(grid.children, function (b) {
      b.classList.toggle('sel', b.getAttribute('data-e') === chosen);
    });
  }

  /* ============================================================
   * 渲染：名片墙 / 打卡 / 弹窗
   * ============================================================ */
  function avatarSrc(r) { return r.avatar_url || r.avatar || ''; }

  function avatarEl(r, cls) {
    var src = avatarSrc(r);
    var wrap = el('div', 'avatar' + (cls ? ' ' + cls : ''));
    if (src) {
      var img = document.createElement('img');
      img.src = src;
      img.alt = '';
      img.loading = 'lazy';
      wrap.appendChild(img);
    } else if (r.avatarEmoji) {
      wrap.textContent = r.avatarEmoji;
      wrap.style.background = hashColor(r.name || r.nickname || '?');
      wrap.style.fontSize = cls ? '40px' : '26px';
    } else {
      var ch = (displayName(r) || '?').trim().charAt(0).toUpperCase();
      wrap.textContent = ch;
      wrap.style.background = hashColor(r.name || r.nickname || ch);
    }
    return wrap;
  }

  function updateKnownPill() {
    var target = Math.max(1, PAGE.targetCount || 1);
    var n = knownCount();
    $('#knownNum').textContent = n;
    $('#knownTotal').textContent = target;
    var pill = $('#knownPill');
    pill.classList.toggle('done', n >= target);
    pill.innerHTML = n >= target
      ? '🏆 太棒了！全班同学你都认识啦'
      : '🧭 我认识了 <span class="pill-num" id="knownNum">' + n + '</span> / <span id="knownTotal">' + target + '</span> 位同学';
    // innerHTML 重建后引用仍在（id 不变），无碍
  }

  function buildCard(r) {
    var card = el('div', 'card');
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', '查看 ' + (r.name || '') + ' 的名片');

    var top = el('div', 'card-top');
    top.appendChild(avatarEl(r));
    var nm = el('div', 'card-name');
    nm.appendChild(el('div', 'nick', displayName(r)));
    var real = realNameLine(r);
    if (!real && !(r.nickname || '').trim()) real = (r.name || '').trim();
    if (real) nm.appendChild(el('div', 'real', real));
    top.appendChild(nm);

    var kb = el('button', 'known-btn' + (isKnown(r.id) ? ' on' : ''), '✓');
    kb.setAttribute('type', 'button');
    kb.title = isKnown(r.id) ? '取消“我认识TA”' : '标记“我认识TA了”';
    kb.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleKnown(r.id);
      kb.classList.toggle('on', isKnown(r.id));
      kb.title = isKnown(r.id) ? '取消“我认识TA”' : '标记“我认识TA了”';
      toast(isKnown(r.id) ? '✅ 已标记认识 ' + displayName(r) : '已取消标记');
    });
    top.appendChild(kb);
    card.appendChild(top);

    var tags = splitTags(r.interests);
    if (tags.length) {
      var tg = el('div', 'tags');
      tags.slice(0, 6).forEach(function (t) {
        var b = el('button', 'tag clickable' + (state.query === t ? ' active' : ''), t);
        b.setAttribute('type', 'button');
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          filterByTag(t);
        });
        tg.appendChild(b);
      });
      card.appendChild(tg);
    }
    var metaBits = [];
    if (r.hometown) metaBits.push('📍 ' + r.hometown);
    if (metaBits.length) card.appendChild(el('div', 'meta', metaBits.join('　')));
    var fun = [];
    if (r.mbti) fun.push('🧠 ' + r.mbti);
    if (r.catchphrase) fun.push('💬 ' + r.catchphrase);
    if (r.hiddenSkill) fun.push('✨ ' + r.hiddenSkill);
    if (fun.length) {
      var fl = el('div', 'funline', fun.join(' · '));
      fl.title = fun.join('\n');
      card.appendChild(fl);
    }
    if (r.intro) card.appendChild(el('div', 'card-intro', r.intro));

    card.addEventListener('click', function () { openModal(r); });
    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(r); }
    });
    return card;
  }

  function matches(r, q) {
    if (!q) return true;
    var hay = esc([r.name, r.nickname, r.hometown, r.interests, r.intro, r.contact, r.mbti, r.catchphrase, r.hiddenSkill].join(' ')).toLowerCase();
    return q.split(/\s+/).every(function (k) { return hay.indexOf(k) !== -1; });
  }

  function renderWall(animate) {
    var grid = $('#grid');
    grid.innerHTML = '';
    var qRaw = state.query.trim();
    var q = qRaw.toLowerCase();
    var arr = state.list.filter(function (r) { return matches(r, q); });
    var count = state.list.length;
    var target = Math.max(1, PAGE.targetCount || 1);

    $('#wallCount').textContent = count ? '(' + count + ')' : '';
    $('#countText').textContent = count >= target ? '🎉 全员到齐：' + count + ' 位同学' : '已认识 ' + count + ' 位同学';
    $('#targetText').textContent = '全班共 ' + target + ' 人';
    $('#progressFill').style.width = Math.min(100, Math.round(count / target * 100)) + '%';
    updateKnownPill();

    var empty = $('#emptyState');
    var cta = empty.querySelector('button');
    if (!arr.length) {
      empty.classList.remove('hidden');
      if (q) {
        $('#emptyText').textContent = '没有找到匹配「' + qRaw + '」的同学，换个关键词试试？';
        if (cta) cta.classList.add('hidden');
      } else {
        $('#emptyText').textContent = '还没有人填写，来做第一个吧！';
        if (cta) cta.classList.remove('hidden');
      }
    } else {
      empty.classList.add('hidden');
      arr.forEach(function (r, i) {
        var c = buildCard(r);
        if (animate) {
          c.style.animationDelay = Math.min(i * 45, 600) + 'ms';
          c.classList.add('card-in');
        }
        grid.appendChild(c);
      });
    }
  }

  function filterByTag(t) {
    if (!$('#wall').classList.contains('active')) goto('wall');
    state.query = t;
    $('#search').value = t;
    renderWall(false);
  }

  /* ---------- 弹窗框架 ---------- */
  function openBackdrop(id) {
    var b = $('#' + id);
    if (!b) return;
    b.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
  function closeBackdrop(b) {
    b.classList.add('hidden');
    if (!document.querySelector('.modal-backdrop:not(.hidden)')) document.body.style.overflow = '';
  }
  function topmostBackdrop() {
    var list = $$('.modal-backdrop:not(.hidden)');
    return list.length ? list[list.length - 1] : null;
  }

  /* ---------- 名片详情弹窗 ---------- */
  function openModal(r) {
    var body = $('#modalBody');
    body.innerHTML = '';

    var head = el('div', 'modal-head');
    head.appendChild(avatarEl(r, 'avatar-lg'));
    head.appendChild(el('div', 'nick', displayName(r)));
    var real = realNameLine(r);
    if (real) head.appendChild(el('div', 'real', real));
    body.appendChild(head);

    var metaBits = [];
    if (r.hometown) metaBits.push('📍 ' + r.hometown);
    if (metaBits.length) {
      var mm = el('div', 'modal-meta');
      mm.textContent = metaBits.join('　');
      body.appendChild(mm);
    }

    var tags = splitTags(r.interests);
    if (tags.length) {
      var sec = el('div', 'modal-section');
      sec.appendChild(el('h4', null, '兴趣标签'));
      var tg = el('div', 'tags');
      tags.forEach(function (t) { tg.appendChild(el('span', 'tag', t)); });
      sec.appendChild(tg);
      body.appendChild(sec);
    }

    if (r.intro) {
      var s2 = el('div', 'modal-section');
      s2.appendChild(el('h4', null, '自我介绍'));
      s2.appendChild(el('p', 'intro-text', r.intro));
      body.appendChild(s2);
    }

    var fun = [];
    if (r.mbti) fun.push('🧠 MBTI：' + r.mbti);
    if (r.catchphrase) fun.push('💬 口头禅：' + r.catchphrase);
    if (r.hiddenSkill) fun.push('✨ 隐藏技能：' + r.hiddenSkill);
    if (fun.length) {
      var sF = el('div', 'modal-section');
      sF.appendChild(el('h4', null, '趣味小档案'));
      fun.forEach(function (f) { sF.appendChild(el('p', 'intro-text', f)); });
      body.appendChild(sF);
    }

    if (PAGE.showContact !== false && r.contact) {
      var s3 = el('div', 'modal-section');
      s3.appendChild(el('h4', null, '联系方式（仅本班可见）'));
      var cr = el('div', 'contact-reveal', r.contact);
      var hint = el('p', 'contact-hint', '👆 点击显示');
      s3.appendChild(cr);
      s3.appendChild(hint);
      var revealed = false;
      cr.addEventListener('click', function () {
        if (revealed) return;
        revealed = true;
        cr.classList.add('revealed');
        hint.textContent = '';
      });
      body.appendChild(s3);
    }

    // 个人打卡按钮
    var knownRow = el('div', 'actions-row');
    var kb = el('button', 'btn ' + (isKnown(r.id) ? 'btn-soft' : 'btn-primary'), isKnown(r.id) ? '✅ 我认识TA了' : '👋 标记为已认识');
    kb.setAttribute('type', 'button');
    kb.addEventListener('click', function () {
      toggleKnown(r.id);
      kb.textContent = isKnown(r.id) ? '✅ 我认识TA了' : '👋 标记为已认识';
      kb.className = 'btn ' + (isKnown(r.id) ? 'btn-soft' : 'btn-primary');
      toast(isKnown(r.id) ? '✅ 已记录：你认识 ' + displayName(r) + ' 啦' : '已取消标记');
    });
    knownRow.appendChild(kb);
    body.appendChild(knownRow);

    openBackdrop('modalBackdrop');
  }
  /* ============================================================
   * 分享 / 二维码 / 复制
   * ============================================================ */
  function copyText(text, okMsg) {
    var fb = function () {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      return ok;
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast(okMsg || '✅ 已复制');
      }).catch(function () {
        toast(fb() ? (okMsg || '✅ 已复制') : '复制失败，请手动长按选择复制', !fb());
      });
    } else {
      toast(fb() ? (okMsg || '✅ 已复制') : '复制失败，请手动选择复制', !fb());
    }
  }
  function ensureQRCode() {
    return new Promise(function (resolve, reject) {
      if (window.QRCode) return resolve();
      var s = document.createElement('script');
      s.src = 'js/vendor/qrcode.min.js';
      s.onload = function () { window.QRCode ? resolve() : reject(new Error('QRCode 未定义')); };
      s.onerror = function () { reject(new Error('二维码组件加载失败')); };
      document.head.appendChild(s);
    });
  }
  function openShare() {
    var url = location.href;
    $('#shareLink').value = url;
    $('#shareDemoNote').classList.toggle('hidden', isSupabase());
    $('#shareHint').textContent = isSupabase()
      ? '手机扫一扫即可打开填写，也可以直接把链接发到班级群'
      : '演示模式下二维码仅供查看效果';
    openBackdrop('shareBackdrop');
    var box = $('#qrBox');
    box.innerHTML = '<p class="qr-fallback">二维码生成中…</p>';
    ensureQRCode().then(function () {
      box.innerHTML = '';
      try {
        new QRCode(box, { text: url, width: 190, height: 190, colorDark: '#0E3E96', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
      } catch (e) {
        box.innerHTML = '<p class="qr-fallback">二维码生成失败，请直接复制链接分享。</p>';
      }
    }).catch(function () {
      box.innerHTML = '<p class="qr-fallback">二维码组件加载失败，请直接复制链接分享。</p>';
    });
  }
  function showSavedCode(code) {
    $('#savedCode').textContent = code;
    openBackdrop('codeBackdrop');
  }

  /* ---------- 随机“认识一下” ---------- */
  function randomPick() {
    if (!state.list.length) { toast('名单还空着，先让大家来填吧 🌱', true); return; }
    var rec = state.list[Math.floor(Math.random() * state.list.length)];
    openModal(rec);
    toast('🎲 缘分到啦：去和「' + displayName(rec) + '」打个招呼吧！');
  }

  /* ============================================================
   * 填写表单
   * ============================================================ */
  function readAvatarFile(file) {
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error('未选择文件'));
      if (!/^image\//.test(file.type)) return reject(new Error('请选择图片文件'));
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var MAX = 320;
        var scale = Math.min(1, MAX / Math.max(img.width, img.height));
        var w = Math.max(1, Math.round(img.width * scale));
        var h = Math.max(1, Math.round(img.height * scale));
        var cv = document.createElement('canvas');
        cv.width = w;
        cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(cv.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('图片读取失败，请换一张试试')); };
      img.src = url;
    });
  }
  function setSubmitAvatarPreview() {
    var pv = $('#avatarPreview');
    pv.innerHTML = '';
    if (avatarDataUrl) {
      var im = document.createElement('img');
      im.src = avatarDataUrl;
      im.alt = '头像预览';
      pv.appendChild(im);
    } else if (avatarEmoji) {
      pv.textContent = avatarEmoji;
      pv.style.background = hashColor(($('#f_name').value.trim() || $('#f_nickname').value.trim() || '?'));
      pv.style.fontSize = '40px';
    } else {
      var nameText = ($('#f_name').value.trim() || $('#f_nickname').value.trim() || '?');
      pv.textContent = nameText.charAt(0).toUpperCase();
      pv.style.background = hashColor(nameText);
      pv.style.fontSize = '';
    }
    markEmojiSel('avatarEmojiGrid', avatarEmoji);
    $('#avatarClear').classList.toggle('hidden', !(avatarDataUrl || avatarEmoji));
  }
  function collectForm() {
    return {
      name: $('#f_name').value.trim(),
      nickname: $('#f_nickname').value.trim(),
      hometown: $('#f_hometown').value.trim(),
      interests: $('#f_interests').value.trim(),
      intro: $('#f_intro').value.trim(),
      contact: PAGE.showContact === false ? '' : $('#f_contact').value.trim(),
      mbti: $('#f_mbti').value,
      catchphrase: $('#f_catchphrase').value.trim(),
      hiddenSkill: $('#f_hiddenSkill').value.trim()
    };
  }
  function submitForm(e) {
    e.preventDefault();
    var err = $('#formError');
    err.textContent = '';
    var d = collectForm();
    if (!d.name) { err.textContent = '请填写姓名'; $('#f_name').focus(); return; }
    if (!d.interests) { err.textContent = '请填写至少一个兴趣爱好'; $('#f_interests').focus(); return; }
    if (!d.intro) { err.textContent = '请写一句介绍自己的话'; $('#f_intro').focus(); return; }

    var dup = null;
    for (var i = 0; i < state.list.length; i++) {
      if (norm(state.list[i].name) === norm(d.name)) { dup = state.list[i]; break; }
    }
    if (dup && !window.confirm('已经有一位「' + displayName(dup) + '」同学的名片了。\n如果那是你，请点“取消”，然后用「修改我的名片」更新；\n如果只是同名，点“确定”继续提交。')) {
      return;
    }

    var btn = $('#formSubmit');
    btn.disabled = true;
    btn.textContent = '⏳ 提交中…';
    addRecord(d, avatarDataUrl, avatarEmoji).then(function (res) {
      writeMyCard({ id: res.record.id, code: res.code });
      $('#classForm').reset();
      avatarDataUrl = '';
      setSubmitAvatarPreview();
      goto('wall');
      return loadList();
    }).then(function (list) {
      state.list = list;
      renderWall(true);
      toast('🎉 提交成功！你的名片已经上墙');
      var mc = readMyCard();
      showSavedCode(mc && mc.code ? mc.code : '');
    }).catch(function (er) {
      err.textContent = '提交失败：' + (er && er.message ? er.message : '未知错误，请重试');
    }).then(function () {
      btn.disabled = false;
      btn.textContent = '🚀 提交名片';
    });
  }
  /* ============================================================
   * 修改 / 删除自己的名片（也支持管理员修改任意名片）
   * ============================================================ */
  function findRec(id) {
    for (var i = 0; i < state.list.length; i++) if (state.list[i].id === id) return state.list[i];
    return null;
  }
  function openEditSelf() {
    var my = readMyCard();
    var rec = my ? findRec(my.id) : null;
    editCtx = { mode: 'self', id: rec ? rec.id : null, code: my ? my.code : '', rec: rec, fromAdmin: false };
    setupEditModal(rec, 'self', !!rec);
  }
  function openEditAdmin(rec) {
    editCtx = { mode: 'admin', id: rec.id, code: '', rec: rec, adminSecret: adminSecret, fromAdmin: true };
    closeBackdrop($('#adminBackdrop'));
    setupEditModal(rec, 'admin', true);
  }
  function setupEditModal(rec, mode, hasLocal) {
    editAvatarDataUrl = '';
    editRemoveAvatar = false;
    editEmoji = '';
    editDefaultAvatar = false;
    var isAdmin = mode === 'admin';

    $('#editTitle').textContent = isAdmin ? '修改名片（管理员）' : '修改我的名片';
    $('#editSub').textContent = isAdmin
      ? ('由管理员修改「' + (rec ? displayName(rec) : '') + '」的名片，姓名可直接更正。')
      : '改好点“保存修改”，你的名片会立刻更新。';

    // 姓名：自己不可改名；管理员可改
    var nameIn = $('#e_name');
    nameIn.readOnly = !isAdmin;
    $('#e_nameWrap').classList.toggle('hidden', isAdmin ? false : false); // 自己只读展示
    $('#e_avatarWrap').classList.toggle('hidden', isAdmin);

    // 找回：仅“自己修改但本机没有记录”时显示
    $('#editPickWrap').classList.toggle('hidden', hasLocal || isAdmin);

    $('#editDelete').textContent = isAdmin ? '🗑 删除该名片' : '🗑 删除我的名片';
    $('#editDelete').classList.remove('hidden');

    // 填表
    fillEditRecord(rec || {});
    $('#editMsg').textContent = '';

    if (!hasLocal && !isAdmin) {
      var sel = $('#e_pick');
      sel.innerHTML = '';
      state.list.forEach(function (r) {
        var opt = document.createElement('option');
        opt.value = r.id;
        opt.textContent = displayName(r) + (r.name && r.name !== displayName(r) ? '（' + r.name + '）' : '') + (r.hometown ? ' · ' + r.hometown : '');
        sel.appendChild(opt);
      });
      if (sel.options.length && rec) sel.value = rec.id;
    }
    openBackdrop('editBackdrop');
  }
  function fillEditRecord(rec) {
    $('#e_name').value = rec.name || '';
    $('#e_nickname').value = rec.nickname || '';
    $('#e_hometown').value = rec.hometown || '';
    $('#e_interests').value = rec.interests || '';
    $('#e_intro').value = rec.intro || '';
    $('#e_contact').value = rec.contact || '';
    $('#e_mbti').value = rec.mbti || '';
    $('#e_catchphrase').value = rec.catchphrase || '';
    $('#e_hiddenSkill').value = rec.hiddenSkill || '';
    $('#e_code').value = '';
    editAvatarDataUrl = '';
    editEmoji = '';
    editDefaultAvatar = false;
    setEditAvatarPreview(rec);
  }
  function setEditAvatarPreview(rec) {
    var pv = $('#e_avatarPrev');
    pv.innerHTML = '';
    var recPhoto = rec ? avatarSrc(rec) : '';
    var recEmoji = rec ? (rec.avatarEmoji || '') : '';
    var useDefault = editDefaultAvatar;
    var showPhoto = editAvatarDataUrl || (!useDefault && !editEmoji && !!recPhoto);
    var showEmoji = editEmoji || (!useDefault && !editAvatarDataUrl && !!recEmoji);
    if (showPhoto) {
      var im = document.createElement('img');
      im.src = editAvatarDataUrl || recPhoto;
      im.alt = '头像预览';
      pv.appendChild(im);
    } else if (showEmoji) {
      pv.textContent = editEmoji || recEmoji;
      pv.style.background = hashColor($('#e_name').value.trim() || '?');
      pv.style.fontSize = '40px';
    } else {
      var nameText = ($('#e_name').value.trim() || '?');
      pv.textContent = nameText.charAt(0).toUpperCase();
      pv.style.background = hashColor(nameText);
      pv.style.fontSize = '';
    }
    var selEmoji = (useDefault || editAvatarDataUrl) ? '' : (editEmoji || recEmoji);
    markEmojiSel('e_avatarEmojiGrid', selEmoji);
    $('#e_avatarClear').classList.toggle('hidden', !(editAvatarDataUrl || editEmoji || editDefaultAvatar || recPhoto || recEmoji));
  }
  function collectEditFields() {
    return {
      name: $('#e_name').value.trim(),
      nickname: $('#e_nickname').value.trim(),
      hometown: $('#e_hometown').value.trim(),
      interests: $('#e_interests').value.trim(),
      intro: $('#e_intro').value.trim(),
      contact: $('#e_contact').value.trim(),
      mbti: $('#e_mbti').value,
      catchphrase: $('#e_catchphrase').value.trim(),
      hiddenSkill: $('#e_hiddenSkill').value.trim()
    };
  }
  function buildEditAvatarIntent(rec) {
    var recPhoto = rec ? avatarSrc(rec) : '';
    var recEmoji = rec ? (rec.avatarEmoji || '') : '';
    if (editDefaultAvatar) {
      return { photo: null, photoRemove: !!recPhoto, emoji: null, emojiRemove: !!recEmoji };
    }
    if (editAvatarDataUrl) {
      return { photo: editAvatarDataUrl, photoRemove: false, emoji: null, emojiRemove: !!(recEmoji || editEmoji) };
    }
    if (editEmoji) {
      return { photo: null, photoRemove: !!recPhoto, emoji: editEmoji, emojiRemove: false };
    }
    return { photo: null, photoRemove: false, emoji: null, emojiRemove: false };
  }
  function saveEdit(e) {
    e.preventDefault();
    var msg = $('#editMsg');
    msg.textContent = '';
    var f = collectEditFields();
    var isAdmin = editCtx && editCtx.mode === 'admin';
    if (!f.name) { msg.textContent = '姓名不能为空'; return; }

    var btn = $('#editSave');
    btn.disabled = true;
    btn.textContent = '⏳ 保存中…';

    function resetBtn() {
      btn.disabled = false;
      btn.textContent = '💾 保存修改';
    }

    if (isAdmin) {
      var secret = editCtx.adminSecret || adminSecret;
      adminUpdate(editCtx.id, secret, f).then(function (ok) {
        if (!ok) { resetBtn(); msg.textContent = '保存失败：权限校验未通过或网络问题'; return null; }
        return reloadList(true);
      }).then(function () {
        closeModalBackdrop($('#editBackdrop'));
        toast('✅ 已保存修改');
      }).catch(function (er) {
        resetBtn();
        msg.textContent = '保存失败：' + (er && er.message ? er.message : '未知错误');
      });
      return;
    }

    var id = editCtx ? editCtx.id : null;
    var code = editCtx && editCtx.code ? editCtx.code : $('#e_code').value.trim();
    if (!id) { resetBtn(); msg.textContent = '请先在上方选择你的名片'; return; }
    if (!code) { resetBtn(); msg.textContent = '请输入修改码（提交成功时显示的那串字符）'; return; }
    var avatar = buildEditAvatarIntent(editCtx ? editCtx.rec : null);
    updateMy(id, code, f, avatar).then(function (ok) {
      if (!ok) { resetBtn(); msg.textContent = '保存失败：修改码不正确或网络问题'; return null; }
      return reloadList(true);
    }).then(function () {
      closeModalBackdrop($('#editBackdrop'));
      toast('✅ 修改成功，名片已更新');
    }).catch(function (er) {
      resetBtn();
      msg.textContent = '保存失败：' + (er && er.message ? er.message : '未知错误');
    });
  }
  function deleteSelfEdit() {
    var msg = $('#editMsg');
    msg.textContent = '';
    if (!window.confirm('确定删除自己的名片吗？删除后需要重新填写。')) return;
    var id = editCtx ? editCtx.id : null;
    var code = editCtx && editCtx.code ? editCtx.code : $('#e_code').value.trim();
    if (!id || !code) { msg.textContent = '缺少名片信息或修改码'; return; }
    var btn = $('#editDelete');
    btn.disabled = true;
    var succeeded = false;
    deleteMy(id, code).then(function (ok) {
      if (!ok) { btn.disabled = false; msg.textContent = '删除失败：修改码不正确'; return; }
      succeeded = true;
      clearMyCard();
      return reloadList(true);
    }).then(function () {
      if (!succeeded) return;
      closeModalBackdrop($('#editBackdrop'));
      toast('🗑 已删除你的名片');
    }).catch(function () { btn.disabled = false; msg.textContent = '删除失败，请重试'; });
  }
  function adminDeleteFromEdit() {
    var msg = $('#editMsg');
    msg.textContent = '';
    var who = editCtx && editCtx.rec ? displayName(editCtx.rec) : '该名片';
    if (!window.confirm('确定删除「' + who + '」的名片吗？此操作不可恢复。')) return;
    var btn = $('#editDelete');
    btn.disabled = true;
    var succeeded = false;
    adminDelete(editCtx.id, editCtx.adminSecret || adminSecret).then(function (ok) {
      if (!ok) { btn.disabled = false; msg.textContent = '删除失败，请重试'; return; }
      succeeded = true;
      return reloadList(true);
    }).then(function () {
      if (!succeeded) return;
      closeModalBackdrop($('#editBackdrop'));
      toast('🗑 已删除「' + who + '」的名片');
    }).catch(function () { btn.disabled = false; msg.textContent = '删除失败，请重试'; });
  }
  function reloadList(animate) {
    return loadList().then(function (list) {
      state.list = list;
      renderWall(!!animate);
    });
  }
  /* ============================================================
   * 管理员面板
   * ============================================================ */
  var latestUnfilled = [];

  function openAdmin() {
    $('#adminLoginMsg').textContent = '';
    var ok = null, secret = '';
    try {
      ok = sessionStorage.getItem('classwall_admin_ok');
      secret = sessionStorage.getItem('classwall_admin_secret') || '';
    } catch (e) { /* 某些环境无 sessionStorage */ }
    if (ok === '1' && secret) {
      adminAuthed = true;
      adminSecret = secret;
      showAdminPanel();
    } else {
      showAdminLogin();
    }
  }
  function showAdminLogin() {
    $('#adminPanel').classList.add('hidden');
    $('#adminLogin').classList.remove('hidden');
    $('#adminPw').value = '';
    $('#adminLoginMsg').textContent = '';
    $('#adminPwHint').textContent = isSupabase()
      ? '提示：初始密码写在 supabase-setup.sql 里，登录后请立即在下方修改。'
      : '演示模式密码：' + DEMO_ADMIN;
    openBackdrop('adminBackdrop');
  }
  function showAdminPanel() {
    $('#adminLogin').classList.add('hidden');
    $('#adminPanel').classList.remove('hidden');
    refreshAdminPanel();
    openBackdrop('adminBackdrop');
  }
  function loginAdmin() {
    var msg = $('#adminLoginMsg');
    msg.textContent = '';
    var pw = $('#adminPw').value.trim();
    if (!pw) { msg.textContent = '请输入密码'; return; }
    adminCheck(pw).then(function (ok) {
      if (!ok) { msg.textContent = '密码不正确'; return; }
      adminAuthed = true;
      adminSecret = pw;
      try {
        sessionStorage.setItem('classwall_admin_ok', '1');
        sessionStorage.setItem('classwall_admin_secret', pw);
      } catch (e) { /* ignore */ }
      showAdminPanel();
      toast('✅ 管理员登录成功');
    }).catch(function () { msg.textContent = '登录失败，请检查网络'; });
  }
  function refreshAdminPanel() {
    renderAdminCards();
    rosterGet(adminSecret).then(function (names) {
      renderRoster(names || []);
    });
  }
  function renderRoster(names) {
    $('#rosterInput').value = (names || []).join('\n');
    var filledSet = {};
    state.list.forEach(function (r) { filledSet[norm(r.name)] = true; });
    var unfilled = (names || []).filter(function (n) { return !filledSet[norm(n)]; });
    latestUnfilled = unfilled;
    var total = names.length;
    var filled = total - unfilled.length;
    $('#adminStat').textContent = '名单共 ' + total + ' 人 · 已填 ' + state.list.length + ' 条 · 未填 ' + unfilled.length + ' 人';
    var box = $('#unfilledBox');
    box.innerHTML = '';
    if (!total) {
      box.appendChild(el('p', 'empty-mini', '还没有名单：把全班 40 个名字（每行一个）粘贴到上方并保存。'));
      return;
    }
    if (!unfilled.length) {
      box.appendChild(el('p', 'empty-mini', '🎉 全员都填啦！'));
      return;
    }
    unfilled.forEach(function (n) { box.appendChild(el('span', 'unfilled-tag', n)); });
  }
  function renderAdminCards() {
    var box = $('#adminCardList');
    box.innerHTML = '';
    if (!state.list.length) {
      box.appendChild(el('p', 'empty-mini', '还没有任何人填写。'));
      return;
    }
    state.list.forEach(function (r) {
      var row = el('div', 'admin-row');
      var who = displayName(r) + (realNameLine(r) ? '（' + r.name + '）' : '');
      if (r.hometown) who += ' · ' + r.hometown;
      row.appendChild(el('span', 'who', who));
      var eb = el('button', 'mini-btn', '编辑');
      eb.setAttribute('type', 'button');
      eb.addEventListener('click', function () {
        closeBackdrop($('#adminBackdrop'));
        openEditAdmin(r);
      });
      var db = el('button', 'mini-btn danger', '删除');
      db.setAttribute('type', 'button');
      db.addEventListener('click', function () { adminDeleteRow(r); });
      row.appendChild(eb);
      row.appendChild(db);
      box.appendChild(row);
    });
  }
  function adminDeleteRow(r) {
    if (!window.confirm('确定删除「' + displayName(r) + '」的名片吗？此操作不可恢复。')) return;
    var succeeded = false;
    adminDelete(r.id, adminSecret).then(function (ok) {
      if (!ok) { toast('删除失败，请重试', true); return; }
      succeeded = true;
      return reloadList(true);
    }).then(function () {
      if (!succeeded) return;
      refreshAdminPanel();
      toast('🗑 已删除「' + displayName(r) + '」');
    }).catch(function () { toast('删除失败，请重试', true); });
  }
  function saveRoster() {
    var raw = $('#rosterInput').value || '';
    var names = raw.split(/\r?\n/).map(function (s) { return norm(s); }).filter(Boolean);
    rosterSet(adminSecret, names).then(function (n) {
      if (n === -1) { toast('保存失败：权限校验未通过', true); return; }
      toast('✅ 名单已保存（' + n + ' 人）');
      refreshAdminPanel();
    }).catch(function () { toast('保存失败，请检查网络', true); });
  }
  function copyUnfilled() {
    if (!latestUnfilled.length) { toast('没有未填名单可复制'); return; }
    copyText(latestUnfilled.join('\n'), '✅ 已复制未填名单');
  }
  function changePw() {
    var msg = $('#pwMsg');
    msg.textContent = '';
    var oldS = $('#pwOld').value.trim();
    var newS = $('#pwNew').value.trim();
    if (!oldS) { msg.textContent = '请输入旧密码'; return; }
    if (newS.length < 6) { msg.textContent = '新密码至少 6 位'; return; }
    if (isSupabase()) {
      adminSetSecret(oldS, newS).then(function (ok) {
        if (!ok) { msg.textContent = '修改失败：旧密码不正确或新密码太短'; return; }
        adminSecret = newS;
        try { sessionStorage.setItem('classwall_admin_secret', newS); } catch (e) {}
        $('#pwOld').value = '';
        $('#pwNew').value = '';
        msg.textContent = '';
        toast('✅ 管理员密码已修改');
      }).catch(function () { msg.textContent = '修改失败，请检查网络'; });
    } else {
      msg.textContent = '演示模式不支持修改管理员密码（正式模式可用）。';
    }
  }

  /* ============================================================
   * 页面配置 / 切换 / 事件
   * ============================================================ */
  function applyPageConfig() {
    if (PAGE.title) {
      $('#pageTitle').textContent = PAGE.title;
      document.title = PAGE.title + ' · ' + (PAGE.classLabel || '班级名片墙');
    }
    if (PAGE.subtitle) $('#pageSubtitle').textContent = PAGE.subtitle;
    if (PAGE.classLabel) $('#classLabel').textContent = PAGE.classLabel;
    if (PAGE.showContact === false) $('#contactField').classList.add('hidden');
  }
  function setModeBadge() {
    var b = $('#modeBadge');
    if (isSupabase()) {
      b.textContent = '正式模式 · 全班实时共享';
    } else {
      b.textContent = '演示模式 · 数据仅存当前浏览器';
      $('#demoReset').classList.remove('hidden');
    }
  }
  function goto(name) {
    $$('.view').forEach(function (v) { v.classList.toggle('active', v.id === name); });
    $$('.tab').forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-tab') === name); });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- SZTU 校徽拖拽 ---------- */
  function initLogoDrag() {
    var logo = $('#heroLogo');
    if (!logo) return;
    var hero = logo.parentElement;
    var pos = null;
    var drag = { active: false, offX: 0, offY: 0 };

    function apply(x, y) {
      var w = logo.offsetWidth, h = logo.offsetHeight;
      var pad = 6;
      var hw = hero.clientWidth, hh = hero.clientHeight;
      x = Math.min(Math.max(pad, x), Math.max(pad, hw - w - pad));
      y = Math.min(Math.max(pad, y), Math.max(pad, hh - h - pad));
      logo.style.left = x + 'px';
      logo.style.top = y + 'px';
    }
    function resetPos() {
      pos = null;
      logo.style.left = '';
      logo.style.top = '';
    }
    window.addEventListener('resize', function () {
      if (!pos) return;
      apply(pos.x, pos.y);
    });
    logo.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      var hr = hero.getBoundingClientRect();
      var lr = logo.getBoundingClientRect();
      drag = { active: true, offX: e.clientX - lr.left, offY: e.clientY - lr.top };
      pos = { x: lr.left - hr.left, y: lr.top - hr.top };
      logo.classList.add('dragging');
      try { logo.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    logo.addEventListener('pointermove', function (e) {
      if (!drag.active) return;
      e.preventDefault();
      var hr = hero.getBoundingClientRect();
      pos.x = e.clientX - hr.left - drag.offX;
      pos.y = e.clientY - hr.top - drag.offY;
      apply(pos.x, pos.y);
    });
    function endDrag() {
      if (!drag.active) return;
      drag.active = false;
      logo.classList.remove('dragging');
    }
    logo.addEventListener('pointerup', endDrag);
    logo.addEventListener('pointercancel', endDrag);
    logo.addEventListener('dblclick', resetPos);
  }

  /* ---------- 精致鼠标光标（光晕环，仅桌面精确指针） ---------- */
  function initCursor() {
    var ring = $('#cursorRing');
    if (!ring) return;
    if (!window.matchMedia) return;
    if (!window.matchMedia('(pointer: fine)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var INTERACTIVE = 'a, button, .card, .tab, input, textarea, select, label[for], .contact-reveal, #heroLogo, [data-goto]';
    var tx = -200, ty = -200, cx = -200, cy = -200, raf = null, shown = false;

    function step() {
      cx += (tx - cx) * 0.16;
      cy += (ty - cy) * 0.16;
      ring.style.transform = 'translate3d(' + cx + 'px,' + cy + 'px,0) translate(-50%, -50%)';
      if (Math.abs(tx - cx) < 0.4 && Math.abs(ty - cy) < 0.4) { raf = null; return; }
      raf = requestAnimationFrame(step);
    }
    window.addEventListener('mousemove', function (e) {
      tx = e.clientX; ty = e.clientY;
      if (!shown) { shown = true; cx = tx; cy = ty; ring.classList.add('show'); }
      var t = document.elementFromPoint(tx, ty);
      var hot = t && t.closest ? t.closest(INTERACTIVE) : null;
      ring.classList.toggle('hover', !!hot);
      if (!raf) raf = requestAnimationFrame(step);
    }, { passive: true });
    window.addEventListener('mousedown', function () { ring.classList.add('down'); }, true);
    window.addEventListener('mouseup', function () { ring.classList.remove('down'); }, true);
    document.addEventListener('mouseleave', function () {
      ring.classList.remove('show');
      shown = false;
    });
  }
  /* ---------- emoji 头像网格初始化 ---------- */
  function initEmojiAvatars() {
    buildEmojiGrid('avatarEmojiGrid', function (e) {
      avatarEmoji = e;
      avatarDataUrl = '';
      var inp = $('#avatarInput');
      if (inp) inp.value = '';
      setSubmitAvatarPreview();
    });
    buildEmojiGrid('e_avatarEmojiGrid', function (e) {
      editEmoji = e;
      editAvatarDataUrl = '';
      editDefaultAvatar = false;
      var inp = $('#e_avatar');
      if (inp) inp.value = '';
      setEditAvatarPreview(editCtx ? editCtx.rec : null);
    });
  }

  /* ---------- 统一弹窗关闭（处理“管理员→编辑”的返回） ---------- */
  function closeModalBackdrop(b) {
    if (!b) return;
    closeBackdrop(b);
    if (b.id === 'editBackdrop') {
      var fromAdmin = editCtx && editCtx.fromAdmin;
      if (editCtx) editCtx.fromAdmin = false;
      if (fromAdmin && adminAuthed) {
        openBackdrop('adminBackdrop');
        refreshAdminPanel();
      }
    }
  }

  /* ---------- 事件绑定 ---------- */
  function bindEvents() {
    $$('[data-goto]').forEach(function (b) {
      b.addEventListener('click', function () { goto(b.getAttribute('data-goto')); });
    });
    $$('.tab').forEach(function (t) {
      t.addEventListener('click', function () { goto(t.getAttribute('data-tab')); });
    });

    var si = $('#search');
    si.addEventListener('input', function () {
      state.query = si.value;
      renderWall(false);
    });

    $('#btnRandom').addEventListener('click', randomPick);
    $('#btnShare').addEventListener('click', openShare);
    $('#btnEditMy').addEventListener('click', openEditSelf);
    $('#formEditLink').addEventListener('click', openEditSelf);
    $('#btnAdmin').addEventListener('click', openAdmin);

    $('#classForm').addEventListener('submit', submitForm);
    $('#avatarInput').addEventListener('change', function () {
      var input = this;
      var f = input.files && input.files[0];
      if (!f) return;
      readAvatarFile(f).then(function (dataUrl) {
        avatarDataUrl = dataUrl;
        avatarEmoji = '';
        setSubmitAvatarPreview();
        toast('头像已就绪，提交名片后生效');
      }).catch(function (e) {
        toast(e.message, true);
        input.value = '';
      });
    });
    $('#avatarClear').addEventListener('click', function () {
      avatarDataUrl = '';
      avatarEmoji = '';
      $('#avatarInput').value = '';
      setSubmitAvatarPreview();
    });
    ['f_name', 'f_nickname'].forEach(function (id) {
      $('#' + id).addEventListener('input', function () {
        if (!avatarDataUrl) setSubmitAvatarPreview();
      });
    });

    // 弹窗关闭
    $$('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () {
        closeModalBackdrop($('#' + b.getAttribute('data-close')));
      });
    });
    $$('.modal-backdrop').forEach(function (bk) {
      bk.addEventListener('click', function (e) {
        if (e.target === bk) closeModalBackdrop(bk);
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeModalBackdrop(topmostBackdrop());
    });

    // 分享 / 复制
    $('#copyLinkBtn').addEventListener('click', function () {
      copyText($('#shareLink').value, '✅ 链接已复制，发到班级群吧');
    });
    $('#copyCodeBtn').addEventListener('click', function () {
      var my = readMyCard();
      copyText(my ? my.code : ($('#savedCode').textContent || ''), '✅ 修改码已复制，请妥善保存');
    });
    $('#copyUnfilledBtn').addEventListener('click', copyUnfilled);

    // 编辑名片弹窗
    $('#editForm').addEventListener('submit', saveEdit);
    $('#editDelete').addEventListener('click', function () {
      if (editCtx && editCtx.mode === 'admin') adminDeleteFromEdit(); else deleteSelfEdit();
    });
    $('#e_pick').addEventListener('change', function () {
      var rec = findRec(this.value);
      if (!rec) return;
      editCtx.id = rec.id;
      editCtx.rec = rec;
      fillEditRecord(rec);
    });
    $('#e_avatar').addEventListener('change', function () {
      var input = this;
      var f = input.files && input.files[0];
      if (!f) return;
      readAvatarFile(f).then(function (dataUrl) {
        editAvatarDataUrl = dataUrl;
        editEmoji = '';
        editDefaultAvatar = false;
        setEditAvatarPreview(editCtx ? editCtx.rec : null);
        toast('新头像已就绪，保存后生效');
      }).catch(function (e) {
        toast(e.message, true);
        input.value = '';
      });
    });
    $('#e_avatarClear').addEventListener('click', function () {
      editAvatarDataUrl = '';
      editEmoji = '';
      editDefaultAvatar = true;
      setEditAvatarPreview(editCtx ? editCtx.rec : null);
    });
    ['e_name', 'e_nickname'].forEach(function (id) {
      $('#' + id).addEventListener('input', function () {
        if (!editAvatarDataUrl && !editEmoji && !editDefaultAvatar) setEditAvatarPreview(editCtx ? editCtx.rec : null);
      });
    });

    // 管理员
    $('#adminLoginBtn').addEventListener('click', loginAdmin);
    $('#adminPw').addEventListener('keydown', function (e) { if (e.key === 'Enter') loginAdmin(); });
    $('#rosterSaveBtn').addEventListener('click', saveRoster);
    $('#pwSaveBtn').addEventListener('click', changePw);

    $('#demoReset').addEventListener('click', resetDemo);
  }

  /* ---------- 演示数据重置 ---------- */
  function resetDemo() {
    if (isSupabase()) return;
    if (!window.confirm('确定把本机数据恢复成示例数据吗？你新增/修改的内容会被清掉。')) return;
    var s = seedDemo();
    demoWrite(s);
    try { localStorage.removeItem(MYCARD_KEY); } catch (e) {}
    try { localStorage.removeItem(KNOWN_KEY); } catch (e) {}
    state.known = {};
    reloadList(true);
    toast('已恢复示例数据');
  }

  /* ---------- 启动 ---------- */
  function init() {
    applyPageConfig();
    setModeBadge();
    initLogoDrag();
    initCursor();
    bindEvents();
    initEmojiAvatars();
    knownRead();
    reloadList(true);
  }

  document.addEventListener('DOMContentLoaded', init);
})();