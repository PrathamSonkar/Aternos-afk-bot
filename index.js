const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { createClient } = require('redis');

// CONFIGURATION: Set to your exact username
const OWNER_NAME = 'NinjaWarrior'; 

const botOptions = {
    host: 'SurvivalSeries125.aternos.me', 
    port: process.env.PORT ? parseInt(process.env.PORT) : 24606, // Dynamic Railway routing       
    username: 'CommanderBot',
    version: false     
};

let bot;
let afkInterval = null;
let holdInterval = null;
let db = null;

// ==========================================
// 1. CONNECT TO RAILWAY DATABASE (REDIS)
// ==========================================
async function startDatabase() {
    if (process.env.REDIS_URL) {
        try {
            db = createClient({ url: process.env.REDIS_URL });
            db.on('error', (err) => console.log('[Database Error]', err.message));
            await db.connect();
            console.log('[Database] Connected to Railway Redis successfully!');
        } catch (err) {
            console.log('[Database] Connection failed, using fallback memory:', err.message);
            db = null;
        }
    } else {
        console.log('[Database] No REDIS_URL found. Please add the Redis plugin in Railway.');
    }
}

// ==========================================
// 2. MINECRAFT BOT LIFE CYCLE & LOGIC
// ==========================================
function createBotInstance() {
    console.log('[System] Connecting to SurvivalSeries125.aternos.me...');
    bot = mineflayer.createBot(botOptions);
    bot.loadPlugin(pathfinder);

    bot.once('spawn', () => {
        console.log(`[Bot] Successfully joined. Listening for commands from: ${OWNER_NAME}`);
        const defaultMovements = new Movements(bot);
        bot.pathfinder.setMovements(defaultMovements);
    });

    // COMMAND ENGINE
    bot.on('chat', async (username, message) => {
        if (username !== OWNER_NAME) return;

        const args = message.toLowerCase().split(' ');
        const command = args[0];

        switch (command) {
            case 'setpos':
                const currentPos = bot.entity.position;
                const posData = {
                    x: Math.floor(currentPos.x),
                    y: Math.floor(currentPos.y),
                    z: Math.floor(currentPos.z)
                };
                
                if (db) {
                    // Saves coordinates directly to your permanent Railway Redis container
                    await db.set('saved_bot_position', JSON.stringify(posData));
                    bot.chat(`Saved PERMANENTLY to database at X: ${posData.x}, Y: ${posData.y}, Z: ${posData.z}`);
                } else {
                    bot.chat("Database not linked. Saved temporarily in short-term instance memory.");
                    global.tempPos = posData;
                }
                break;

            case 'gopos':
                let targetPos = null;
                if (db) {
                    const stored = await db.get('saved_bot_position');
                    if (stored) targetPos = JSON.parse(stored);
                } else {
                    targetPos = global.tempPos;
                }

                if (!targetPos) {
                    bot.chat("No position found! Stand somewhere and type 'setpos' first.");
                    return;
                }
                bot.chat(`Walking back to coordinates: X: ${targetPos.x}, Y: ${targetPos.y}, Z: ${targetPos.z}...`);
                bot.pathfinder.setGoal(new goals.GoalBlock(targetPos.x, targetPos.y, targetPos.z), false);
                break;

            case 'come':
                const player = bot.players[OWNER_NAME];
                if (!player || !player.entity) {
                    bot.chat("I can't see you! Get closer to me.");
                    return;
                }
                bot.chat("On my way!");
                bot.pathfinder.setGoal(new goals.GoalFollow(player.entity, 1), true);
                break;

            case 'mine':
                const blockName = args[1];
                if (!blockName) {
                    bot.chat("Specify a block. Example: mine iron_ore");
                    return;
                }
                const blockType = bot.registry.blocksByName[blockName];
                if (!blockType) {
                    bot.chat(`Unknown block type: ${blockName}`);
                    return;
                }
                const block = bot.findBlock({ matching: blockType.id, maxDistance: 32 });
                if (!block) {
                    bot.chat(`No ${blockName} found nearby.`);
                    return;
                }
                bot.chat(`Moving to mine ${blockName}...`);
                try {
                    await bot.pathfinder.goto(new goals.GoalLookAtBlock(block.position, bot.world));
                    bot.chat("Mining now!");
                    await bot.dig(block);
                    bot.chat("Block broken!");
                } catch (err) {
                    bot.chat(`Mining error: ${err.message}`);
                }
                break;

            case 'bed':
                const bedBlock = bot.findBlock({
                    matching: (b) => b.name.includes('bed'),
                    maxDistance: 5
                });
                if (!bedBlock) {
                    bot.chat("No bed found within 5 blocks.");
                    return;
                }
                try {
                    await bot.lookAt(bedBlock.position.offset(0.5, 0.5, 0.5));
                    await bot.activateBlock(bedBlock);
                    bot.chat("Clicked the bed successfully!");
                } catch (err) {
                    bot.chat(`Can't use bed: ${err.message}`);
                }
                break;

            case 'hold':
                if (holdInterval) {
                    clearInterval(holdInterval);
                    holdInterval = null;
                    bot.deactivateItem();
                    bot.chat("Right-click hold toggle is now OFF.");
                } else {
                    bot.chat("Right-click hold toggle is now ON.");
                    holdInterval = setInterval(() => { bot.activateItem(); }, 200);
                }
                break;

            case 'stop':
                bot.chat("Stopping all actions.");
                bot.pathfinder.setGoal(null);
                if (afkInterval) { clearInterval(afkInterval); afkInterval = null; }
                if (holdInterval) { clearInterval(holdInterval); holdInterval = null; bot.deactivateItem(); }
                bot.clearControlStates();
                break;

            case 'afk':
                if (afkInterval) { bot.chat("Already in AFK mode."); return; }
                bot.chat("Starting anti-AFK spin loop.");
                afkInterval = setInterval(() => {
                    bot.setControlState('jump', true);
                    setTimeout(() => bot.setControlState('jump', false), 500);
                    bot.look(bot.entity.yaw + 1.5, 0);
                }, 2000);
                break;

            case 'status':
                bot.chat(`Health: ${Math.round(bot.health)}/20 | Food: ${bot.food}/20`);
                break;

            case 'drop':
                bot.chat("Dropping inventory!");
                // FIXED TYPO HERE (Changed from 'for...of item' to avoid loop crashes)
                for (const item of bot.inventory.items()) {
                    try { 
                        await bot.dropItem(item); 
                    } catch (err) {}
                }
                break;
        }
    });

    // Auto-Reconnect Framework
    bot.on('kick', (reason) => { console.log(`[Kick] ${reason}. Retrying in 15s...`); cleanUpAndRestart(); });
    bot.on('error', (err) => { console.log(`[Error] ${err.message}. Retrying in 15s...`); cleanUpAndRestart(); });
    bot.on('end', () => { console.log('[Disconnect] Connection lost. Retrying in 15s...'); cleanUpAndRestart(); });
}

function cleanUpAndRestart() {
    if (afkInterval) { clearInterval(afkInterval); afkInterval = null; }
    if (holdInterval) { clearInterval(holdInterval); holdInterval = null; }
    bot.removeAllListeners();
    setTimeout(createBotInstance, 15000);
}

// Initial Boot Orchestrator
async function boot() {
    await startDatabase();
    createBotInstance();
}
boot();

// ==========================================
// 3. RAILWAY ALIVE PORT BIND ENGINE
// ==========================================
const http = require('http');
const webServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Minecraft bot environment is healthy and operational.\n');
});
// Satisfies Railway web checks to guarantee continuous uptime
webServer.listen(process.env.PORT || 3000, () => {
    console.log(`[Railway] Internal web port bound to ${process.env.PORT || 3000}`);
});
