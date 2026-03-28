// 防小白专用安全脚本
(function () {
  // 禁止右键菜单
  document.addEventListener('contextmenu', function (e) {
    e.preventDefault();
  });

  // 禁止选中文字
  document.addEventListener('selectstart', function (e) {
    e.preventDefault();
  });

  // 禁止复制
  document.addEventListener('copy', function (e) {
    e.preventDefault();
  });

  // 禁止 F12
  document.addEventListener('keydown', function (e) {
    if (e.key === 'F12') {
      e.preventDefault();
    }
    // 禁止 Ctrl+U 查看源码
    if (e.ctrlKey && e.key === 'u') {
      e.preventDefault();
    }
    // 禁止 Ctrl+S 另存网页
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
    }
    // 禁止 Ctrl+Shift+I 打开控制台
    if (e.ctrlKey && e.shiftKey && e.key === 'I') {
      e.preventDefault();
    }
  });

  // 禁止别人用 iframe 嵌套你的网站
  if (window.top !== window.self) {
    window.top.location = window.location.href;
  }
})();
