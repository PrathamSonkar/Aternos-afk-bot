function getDuration(bot, spawnTime) {
    if (!bot || !spawnTime) return '<span style="color:#ef4444;">0h 0m 0s (Bot Disconnected)</span>';
    const diff = Date.now() - spawnTime;
    const hrs = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    return `<span style="color:#a855f7; font-weight:bold;">${hrs}h ${mins}m ${secs}s</span>`;
}

function renderPanel({ bot, spawnTime, panelLogs }) {
    const statusText = bot ? '<span style="color:#2ecc71;">ONLINE</span>' : '<span style="color:#e74c3c;">OFFLINE</span>';
    const logItems = (panelLogs || []).map(l => `<div style="padding:4px 0;border-bottom:1px solid #2d3748;">${l}</div>`).reverse().join('');
    
    let invHtml = '<span style="color:#718096; font-style: italic;">Inventory hidden or bot offline</span>';
    if (bot && bot.inventory) {
        const items = bot.inventory.items();
        if (items.length > 0) {
            invHtml = items.map(i => `
                <div style="background:#1a202c; padding:8px 12px; border-radius:6px; border:1px solid #4a5568; display:inline-block; margin:4px; font-family:monospace; font-size:13px; color:#edf2f7;">
                    📦 <span style="color:#38bdf8; font-weight:bold;">${i.name}</span> × ${i.count}
                </div>
            `).join('');
        } else {
            invHtml = '<span style="color:#a0aec0; font-style: italic;">Inventory is completely empty</span>';
        }
    }

    return `
        <!DOCTYPE html><html><head><meta charset="utf-8"><title>Console</title><meta name="viewport" content="width=device-width,initial-scale=1">
        <style>
            body{font-family:sans-serif;background:#1a202c;color:#e2e8f0;padding:20px;margin:0;}
            .box{max-width:650px;margin:20px auto;background:#2d3748;padding:20px;border-radius:8px;box-shadow: 0 10px 15px -3px rgba(0,0,0,0.3);}
            .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:15px 0;}
            .btn{padding:12px;color:#fff;text-align:center;text-decoration:none;border-radius:4px;font-weight:bold;font-size:14px;box-sizing:border-box;}
            .console{background:#0f172a;height:180px;overflow-y:auto;padding:10px;font-family:monospace;color:#38bdf8;font-size:12px;border-radius:4px;margin-bottom:15px;box-shadow:inset 0 2px 4px rgba(0,0,0,0.6);}
            .input-group{display:flex;gap:8px;margin-bottom:20px;}
            .input-box{flex-grow:1;padding:12px;border-radius:4px;border:1px solid #4a5568;background:#0f172a;color:#fff;font-family:monospace;font-size:14px;}
            .input-box:focus{outline:2px solid #3b82f6;}
            .send-btn{padding:12px 24px;background:#3b82f6;color:white;border:none;border-radius:4px;font-weight:bold;cursor:pointer;font-size:14px;}
            .send-btn:hover{background:#2563eb;}
            .meta-bar{background:#1e293b;padding:12px;border-radius:6px;font-size:14px;margin-bottom:20px;border-left:4px solid #a855f7;}
            .inv-card{background:#232d3f;padding:15px;border-radius:6px;margin-top:20px;border:1px solid #2d3748;}
            .cmd-list{font-size:11px;color:#94a3b8;margin-top:-15px;margin-bottom:15px;font-family:monospace;}
        </style>
        <script>setTimeout(()=>{window.location.reload();},4000);</script></head><body><div class="box">
        <h3>🤖 Bot Control Panel (${statusText})</h3>
        
        <div class="meta-bar">
            ⏱️ <strong>Active Server Duration:</strong> ${getDuration(bot, spawnTime)}
        </div>

        <div class="grid">
            <a href="/action?cmd=start" class="btn" style="background:#2ecc71;">Start Bot</a>
            <a href="/action?cmd=stop" class="btn" style="background:#e74c3c;">Stop Bot</a>
            <a href="/action?cmd=afk" class="btn" style="background:#f1c40f;color:#000;">AFK Loop</a>
            <a href="/action?cmd=clear_stop" class="btn" style="background:#7f8c8d;">Clear Actions</a>
            <!-- NEW UI INTERFACE COMMAND SHORTCUTS FOR PERSISTENT SLEEP STATE PROCESSING -->
            <a href="/action?cmd=console&text=sleep" class="btn" style="background:#a855f7; grid-column: span 1;">🛌 Sleep Mode</a>
            <a href="/action?cmd=console&text=stop" class="btn" style="background:#dc2626; grid-column: span 1;">⏰ Wake Up</a>
        </div>

        <h4>💻 Execute Command Terminal:</h4>
        <form action="/action" method="get" class="input-group">
            <input type="hidden" name="cmd" value="console">
            <input type="text" name="text" class="input-box" placeholder="Type bot commands here..." required autocomplete="off">
            <button type="submit" class="send-btn">Execute</button>
        </form>
        <div class="cmd-list">Available: come | status | drop | hold | setpos | gopos | bed | mine [block_name] | sleep</div>
        
        <h4>Console Logs:</h4>
        <div class="console">${logItems}</div>

        <div class="inv-card">
            <h4 style="margin-top:0; margin-bottom:10px; color:#38bdf8;">🎒 Live Bot Inventory:</h4>
            <div>${invHtml}</div>
        </div>
        </div></body></html>
    `;
}

module.exports = { renderPanel };
