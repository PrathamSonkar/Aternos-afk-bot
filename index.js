const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');

// CONFIGURATION: Change to your exact in-game name
const OWNER_NAME = 'YourMinecraftName'; 

const botOptions = {
    host: 'SurvivalSeries125.aternos.me', 
    port: 24606,       
    username: 'CommanderBot',
    version: false     
};

let bot;
let afkInterval = null;

function createBotInstance() {
    console.log('[System] Connecting to SurvivalSeries125.aternos.me:24606...');
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

            case 'stop':
                bot.chat("Stopping all actions.");
                bot.pathfinder.setGoal(null);
                if (afkInterval) {
                    clearInterval(afkInterval);
                    afkInterval = null;
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
                for (const item of items) {
                    try {
                        await bot.dropItem(item);
                    } catch (err) {}
                }
                break;
        }
    });

    // Auto-Defend System
    bot.on('physicTick', () => {
        if (!bot.entity) return;
        const mobFilter = (entity) => entity.type === 'mob' && entity.position.distanceTo(bot.entity.position) < 4;
        const enemy = bot.nearestEntity(mobFilter);
        if (enemy) {
            bot.lookAt(enemy.position.offset(0, enemy.height, 0));
            bot.attack(enemy);
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
    bot.removeAllListeners();
    setTimeout(createBotInstance, 15000);
}

createBotInstance();
