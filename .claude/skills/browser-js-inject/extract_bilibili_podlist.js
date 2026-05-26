/**
 * Bilibili 合集/课程分P链接提取脚本（Pod List 版）
 * 目标页面：B站课程/合集播放页右侧的 "视频列表" 区域
 * 定位方式：div.video-pod__body
 * 使用方法：在目标页面打开浏览器控制台(F12)，粘贴此脚本并回车执行
 */

(function() {
    const container = document.querySelector('div.video-pod__body');
    if (!container) {
        console.error('%c[错误] ', 'color: red; font-weight: bold;', '未找到视频列表容器，请确认当前页面包含 div.video-pod__body');
        console.log('尝试备用选择器...');
        // 备用选择器兜底
        const fallback = document.querySelector('#mirror-vdcon .video-pod__body') ||
                         document.querySelector('.video-pod__list') ||
                         document.querySelector('.video-pod__body');
        if (!fallback) {
            console.error('备用选择器也未命中，请检查页面结构');
            return;
        }
    }

    const items = (container || document).querySelectorAll('.pod-item.video-pod__item');
    if (!items.length) {
        console.error('%c[错误] ', 'color: red; font-weight: bold;', '未找到任何视频项 (.pod-item.video-pod__item)');
        return;
    }

    const results = [];
    const summary = [];

    items.forEach((item, index) => {
        const bv = item.getAttribute('data-key');
        if (!bv) return;

        // 统计分P数量：page-list 内的 page-item.sub 数量
        const pageList = item.querySelector('.page-list.simple');
        const subItems = pageList ? pageList.querySelectorAll('.page-item.sub') : [];
        const pageCount = subItems.length || 1; // 保底至少1P

        const links = [];
        for (let p = 1; p <= pageCount; p++) {
            links.push(`https://www.bilibili.com/video/${bv}?p=${p}`);
        }

        results.push(...links);
        summary.push({
            index: index + 1,
            bv: bv,
            pages: pageCount,
            links: links
        });
    });

    // 挂载到 window 方便外部调用
    window.__bilibiliPodUrls = results;
    window.__bilibiliPodSummary = summary;

    // ===== 输出结果 =====
    console.log('%c[提取完成] ', 'color: #00a1d6; font-size: 14px; font-weight: bold;',
        `共 ${summary.length} 个主视频，${results.length} 个分P链接`);

    console.log('%c===== 明细 =====', 'color: #00a1d6;');
    summary.forEach(s => {
        console.log(`#${s.index} ${s.bv}: ${s.pages} 个切片`);
    });

    console.log('%c===== 链接列表（每行一个，直接复制） =====', 'color: #00a1d6;');
    console.log(results.join('\n'));

    console.log('%c===== JSON 数组格式 =====', 'color: #00a1d6;');
    console.log(JSON.stringify(results, null, 2));

    console.log('%c===== 使用提示 =====', 'color: #fb7299;');
    console.log('所有链接已保存到 window.__bilibiliPodUrls');
    console.log('明细对象已保存到 window.__bilibiliPodSummary');
    console.log('复制纯文本：copy(window.__bilibiliPodUrls.join("\\n"))');
})();
