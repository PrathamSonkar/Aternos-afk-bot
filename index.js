const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');

// CONFIGURATION: Set to your exact username
const OWNER_NAME = 'NinjaWarrior'; 

const botOptions = {
    host: 'SurvivalSeries125.aternos.me', 
    port: process.env.PORT ? parseInt(process.env.PORT) : 24606, // Railway port fix       
    username: 'CommanderBot',
    version: false     
};

let bot;
let afkInterval = null;
let holdInterval = null;

// Object to store your saved position coordinates temporarily in memory
let savedPosition = null; 

function createBotInstance() {
    console.log('[System] Connecting to SurvivalSeries125.aternos.me...');
    bot = mineflayer.createBot(botOptions);

    // Load Pathfinder Plugin
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
                // Saves the bot's exact current location coordinates
                const currentPos = bot.entity.position;
                savedPosition = {
                    x: Math.floor(currentPos.x),
                    y: Math.floor(currentPos.y),
                    z: Math.floor(currentPos.z)
                };
                bot.chat(`Position saved successfully at X: ${savedPosition.x}, Y: ${savedPosition.y}, Z: ${savedPosition.z}`);
                break;

            case 'gopos':
                // Commands the bot to pathfind back to the saved coordinates
                if (!savedPosition) {
                    bot.chat("No position has been saved yet! Type 'setpos' first.");
                    return;
                }
                bot.chat(`Moving back to saved position at X: ${savedPosition.x}, Y: ${savedPosition.y}, Z: ${savedPosition.z}...`);
                bot.pathfinder.setGoal(new goals.GoalBlock(savedPosition.x, savedPosition.y, savedPosition.z), false);
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
                    bot.chat("Please specify a block. Example: mine iron_ore");
                    return;
                }

                const registry = bot.registry;
                const blockType = registry.blocksByName[blockName];
                if (!blockType) {
                    bot.chat(`I don't know what ${blockName} is.`);
                    return;
                }

                const block = bot.findBlock({
                    matching: blockType.id,
                    maxDistance: 32
                });

                if (!block) {
                    bot.chat(`Could not find any ${blockName} nearby.`);
                    return;
                }

                bot.chat(`Moving to mine ${blockName}...`);
                
                try {
                    await bot.pathfinder.goto(new goals.GoalLookAtBlock(block.position, bot.world));
                    bot.chat("Mining now!");
                    await bot.dig(block);
                    bot.chat("Block broken!");
                } catch (err) {
                    bot.chat(`Cannot mine block: ${err.message}`);
                }
                break;

            case 'bed':
                bot.chat("Searching for a nearby bed...");
                const bedBlock = bot.findBlock({
                    matching: (block) => block.name.includes('bed'),
                    maxDistance: 5
                });

                if (!bedBlock) {
                    bot.chat("No bed found within 5 blocks of me!");
                    return;
                }

                try {
                    await bot.lookAt(bedBlock.position.offset(0.5, 0.5, 0.5));
                    await bot.activateBlock(bedBlock);
                    bot.chat("I right-clicked the bed to set spawn/sleep!");
                } catch (err) {
                    bot.chat(`Can't use bed right now: ${err.message}`);
                }
                break;

            case 'hold':
                if (holdInterval) {
                    clearInterval(holdInterval);
                    holdInterval = null;
                    bot.deactivateItem();
                    bot.chat("Right-click hold toggle is now OFF.");
                } else {
                    bot.chat("Right-click hold toggle is now ON. Holding use item...");
                    holdInterval = setInterval(() => {
                        bot.activateItem(); 
                    }, 200);
                }
                break;

            case 'stop':
                bot.chat("Stopping all actions.");
                bot.pathfinder.setGoal(null);
                
                if (afkInterval) {
                    clearInterval(afkInterval);
                    afkInterval = null;
                }
                if (holdInterval) {
                    clearInterval(holdInterval);
                    holdInterval = null;
                    bot.deactivateItem();
                }
                bot.clearControlStates();
                break;

            case 'afk':
                if (afkInterval) {
                    bot.chat("I am already in AFK mode.");
                    return;
                }
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
                bot.chat("Dropping my inventory!");
                const items = bot.inventory.items();
                for (const item of item) {
                    try {
                        await bot.dropItem(item);
                    } catch (err) {}
                }
                break;
        }
    });

    // Auto-Reconnect System
    bot.on('kick', (reason) => {
        console.log(`[Disconnect] Kicked: ${reason}. Reconnecting in 15s...`);
        cleanUpAndRestart();
    });

    bot.on('error', (err) => {
        console.log(`[Error] Connection error: ${err.message}. Reconnecting in 15s...`);
        cleanUpAndRestart();
    });

    bot.on('end', () => {
        console.log('[Disconnect] Lost connection. Reconnecting in 15s...');
        cleanUpAndRestart();
    });
}

function cleanUpAndRestart() {
    if (afkInterval) {
        clearInterval(afkInterval);
        afkInterval = null;
    }
    if (holdInterval) {
        clearInterval(holdInterval);
        holdInterval = null;
    }
    bot.removeAllListeners();
    setTimeout(createBotInstance, 15000);
}

// Start the Bot
createBotInstance();

// RAILWAY ALIVE LOOP
const http = require('http');
const webServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot environment is healthy\n');
});
const webPort = process.env.PORT || 3000;
webServer.listen(webPort, () => {
    console.log(`[Railway] Internal web listener attached to port ${webPort}`);
});
