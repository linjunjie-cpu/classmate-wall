/* ============================================================
 * 班级名片墙 · 配置文件
 * 平时只需要改这个文件即可，其他文件不用动。
 *
 * 两种运行模式：
 *   mode: 'demo'      —— 演示模式：双击打开网页就能看效果。
 *                         数据只保存在“当前这台电脑的浏览器”里，
 *                         别人看不到，也不能用于正式收集。
 *   mode: 'supabase'  —— 正式模式：全班数据实时共享。
 *                         需要先按 README.md 的步骤注册 Supabase，
 *                         建好表，然后把下面的 url / anonKey 填上。
 * ============================================================ */

window.APP_CONFIG = {
  mode: 'supabase',   // 改成 'supabase' 即切换到正式共享模式

  /* ---------- Supabase 配置（mode 为 'supabase' 时才需要） ---------- */
  supabase: {
    url: 'https://bnjawrffjeudcghxafpo.supabase.co',                 // 例如：'https://abcdefgh123.supabase.co'
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJuamF3cmZmamV1ZGNnaHhhZnBvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5MjUyMDIsImV4cCI6MjEwNDUwMTIwMn0.6m_cOXJmX4I8HBURUK-GmdBeLC6roXT1t4F-NoL5YAY',             // Project Settings -> API -> Project API keys -> anon public
    table: 'classmates',     // 数据表名（默认即可，与 supabase-setup.sql 一致）
    avatarBucket: 'avatars'  // 头像图片存储桶名（默认即可）
  },

  /* ---------- 页面文字（按你的班级修改） ---------- */
  page: {
    title: '深圳技术大学',
    subtitle: '机械一班自己的名片墙',
    classLabel: '2026级机械一班',
    targetCount: 40,          // 全班人数，用来显示“已认识 X / 40”
    showContact: true          // 是否允许填写和展示联系方式（仅本班公开）
  },

  /* ---------- 演示模式设置 ---------- */
  demo: {
    adminPassword: 'admin123',  // 演示模式管理员密码（正式 Supabase 模式在数据库里校验，与此无关）
    roster: [
      '林晓雨', '陈昊', '苏婉晴', '王梓睿', '赵一鸣', '何佳怡', '梁子轩', '周诗涵',
      '张伟', '李娜', '刘洋', '王子健'
    ]
  },

  /* ---------- 演示模式自带示例数据（可自由增删改） ----------
   * 字段说明：
   *   name 姓名(必填) / nickname 昵称 / hometown 家乡 /
   *   interests 兴趣(逗号分隔) / intro 自我介绍 / contact 联系方式 /
   *   mbti / catchphrase 口头禅 / hiddenSkill 隐藏技能（趣味字段，选填）/
   *   avatar 照片(可留空) / avatarEmoji emoji 头像(可留空)
   * 头像优先级：照片 > emoji > 名字首字
   */
  demoData: [
    { name: '林晓雨', nickname: '小雨', hometown: '广东 · 深圳',
      interests: '摄影、徒步、听播客', intro: '喜欢用镜头记录生活，周末常去爬山，欢迎一起约拍！',
      contact: '电话号码：13800000001', mbti: 'INFJ', catchphrase: '绝了',
      hiddenSkill: '会用手机拍出电影感短片', avatar: '', avatarEmoji: '' },
    { name: '陈昊', nickname: '阿昊', hometown: '湖南 · 长沙',
      interests: '篮球、电竞、吉他', intro: '篮球场常驻选手，宿舍楼下的球场见！',
      contact: 'QQ：123456789', mbti: 'ESTP', catchphrase: '问题不大',
      hiddenSkill: '单手转篮球不掉', avatar: '', avatarEmoji: '' },
    { name: '苏婉晴', nickname: '婉婉', hometown: '江苏 · 苏州',
      interests: '书法、汉服、电影', intro: '想把喜欢的古诗词和好电影都分享给大家。',
      contact: '电话号码：13800000002', mbti: 'ISFJ', catchphrase: '就是说嘛',
      hiddenSkill: '听一遍就能记住整首歌的歌词', avatar: '', avatarEmoji: '🦋' },
    { name: '王梓睿', nickname: '阿梓', hometown: '福建 · 厦门',
      interests: '桌游、二次元、做饭', intro: '会做一点家常菜，宿舍聚餐可以找我掌勺。',
      contact: '', mbti: 'INTP', catchphrase: '这波不亏',
      hiddenSkill: '做菜能复刻外卖的味道', avatar: '', avatarEmoji: '🎮' },
    { name: '赵一鸣', nickname: '鸣仔', hometown: '山东 · 青岛',
      interests: '羽毛球、骑行、音乐', intro: '海边长大，骑车看海就是我的快乐源泉。',
      contact: 'QQ：987654321', mbti: 'ESFP', catchphrase: '整挺好',
      hiddenSkill: '骑车一口气能骑三小时', avatar: '', avatarEmoji: '' },
    { name: '何佳怡', nickname: '佳佳', hometown: '四川 · 成都',
      interests: '跳舞、追剧、美食探店', intro: '成都美食地图活攻略，带你吃遍全城不踩雷。',
      contact: '电话号码：13800000003', mbti: 'ENFP', catchphrase: '冲鸭',
      hiddenSkill: '看一遍就会跳的舞', avatar: '', avatarEmoji: '🌻' },
    { name: '梁子轩', nickname: '小梁', hometown: '广东 · 广州',
      interests: '阅读、口琴、桌游', intro: '看起来安静但很好相处，欢迎来找我聊书。',
      contact: '', mbti: 'ISTP', catchphrase: '还行吧',
      hiddenSkill: '口琴能吹整首《天空之城》', avatar: '', avatarEmoji: '🎸' },
    { name: '周诗涵', nickname: '诗诗', hometown: '湖北 · 武汉',
      interests: '手账、烘焙、跑步', intro: '未来的医生一枚，爱好是烤各种小甜点。',
      contact: 'QQ：111222333', mbti: 'INFJ', catchphrase: '好耶',
      hiddenSkill: '烤的曲奇从来没翻过车', avatar: '', avatarEmoji: '🐱' }
  ]
};