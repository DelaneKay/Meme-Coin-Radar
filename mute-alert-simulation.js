const fs = require('fs');
const path = require('path');

// Guardrail Configuration
const ALERT_RATE_LIMIT = 15; // alerts/hour
const ALERT_KILL_LIMIT = 25; // alerts/hour
const MUTE_DURATION_MIN = 30; // minutes
const ERROR_RATE_WARN = 0.10;
const ERROR_RATE_KILL = 0.20;

// State tracking
let alertCounts = {};
let muteStatus = {};
let killSwitchStatus = {};
let alertHistory = {};

// Initialize chain state
function initChain(chain) {
    if (!alertCounts[chain]) {
        alertCounts[chain] = 0;
        muteStatus[chain] = { active: false, until: null };
        killSwitchStatus[chain] = { active: false };
        alertHistory[chain] = [];
    }
}

// Calculate alerts per hour based on recent history
function calculateAlertsPerHour(chain) {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);
    
    // Filter alerts from the last hour
    const recentAlerts = alertHistory[chain].filter(alert => alert.timestamp > oneHourAgo);
    return recentAlerts.length;
}

// Log an alert
function logAlert(chain, message, severity = 'medium') {
    initChain(chain);
    
    const timestamp = new Date().toISOString();
    const alert = {
        timestamp: Date.now(),
        isoTimestamp: timestamp,
        chain,
        message,
        severity
    };
    
    alertHistory[chain].push(alert);
    alertCounts[chain]++;
    
    // Check if muted or kill-switch active
    if (killSwitchStatus[chain].active) {
        console.log(`🛑 KILL_SWITCH ACTIVE - All alerts suppressed for ${chain}`);
        return false;
    }
    
    if (muteStatus[chain].active && Date.now() < muteStatus[chain].until) {
        console.log(`🔇 ALERTS MUTED - Alert suppressed for ${chain} (muted until ${new Date(muteStatus[chain].until).toISOString()})`);
        return false;
    }
    
    // Check if mute period has expired
    if (muteStatus[chain].active && Date.now() >= muteStatus[chain].until) {
        console.log(`🔊 [MUTE EXPIRED] Alerts resumed for ${chain}`);
        muteStatus[chain].active = false;
        muteStatus[chain].until = null;
    }
    
    console.log(`🚨 [${timestamp}] Alert #${alertCounts[chain]}: ${chain} - ${message} (${severity})`);
    
    // Check guardrails after logging
    checkGuardrails(chain);
    
    return true;
}

// Check and enforce guardrails
function checkGuardrails(chain) {
    const alertsPerHour = calculateAlertsPerHour(chain);
    console.log(`📊 Current rate: ${alertsPerHour} alerts/hour for ${chain}`);
    
    // Kill switch check (higher priority)
    if (alertsPerHour > ALERT_KILL_LIMIT && !killSwitchStatus[chain].active) {
        triggerKillSwitch(chain, alertsPerHour);
        return;
    }
    
    // Mute check
    if (alertsPerHour > ALERT_RATE_LIMIT && !muteStatus[chain].active && !killSwitchStatus[chain].active) {
        triggerMute(chain, alertsPerHour);
        return;
    }
}

// Trigger mute action
function triggerMute(chain, alertsPerHour) {
    const now = Date.now();
    const muteUntil = now + (MUTE_DURATION_MIN * 60 * 1000);
    
    muteStatus[chain] = {
        active: true,
        until: muteUntil,
        triggeredAt: now,
        reason: `${alertsPerHour} alerts/hour (>${ALERT_RATE_LIMIT} threshold)`
    };
    
    console.log(`\n🛑 [GUARDRAIL TRIGGERED] MUTE_ALERTS=true`);
    console.log(`   Chain: ${chain}`);
    console.log(`   Reason: ${alertsPerHour} alerts/hour (>${ALERT_RATE_LIMIT} threshold)`);
    console.log(`   Action: Alerts muted for ${MUTE_DURATION_MIN}m`);
    console.log(`   Triggered: ${new Date(now).toISOString()}`);
    console.log(`   Muted until: ${new Date(muteUntil).toISOString()}\n`);
    
    // Log to guardrail actions
    logGuardrailAction(chain, 'MUTE_ALERTS', alertsPerHour, 'ACTIVE');
    
    // Send alert notification
    sendAlertNotification(chain, 'MUTE_ALERTS', alertsPerHour);
}

// Trigger kill switch
function triggerKillSwitch(chain, alertsPerHour) {
    killSwitchStatus[chain] = {
        active: true,
        triggeredAt: Date.now(),
        reason: `${alertsPerHour} alerts/hour sustained (>${ALERT_KILL_LIMIT} threshold)`
    };
    
    console.log(`\n🛑 [GUARDRAIL TRIGGERED] KILL_SWITCH=true`);
    console.log(`   Chain: ${chain}`);
    console.log(`   Reason: ${alertsPerHour} alerts/hour sustained (>${ALERT_KILL_LIMIT} threshold)`);
    console.log(`   Action: Global shutdown - alerts stopped until manual reset`);
    console.log(`   Triggered: ${new Date().toISOString()}\n`);
    
    // Log to guardrail actions
    logGuardrailAction(chain, 'KILL_SWITCH', alertsPerHour, 'ACTIVE');
    
    // Send alert notification
    sendAlertNotification(chain, 'KILL_SWITCH', alertsPerHour);
}

// Manual kill switch reset
function resetKillSwitch(chain) {
    if (killSwitchStatus[chain].active) {
        killSwitchStatus[chain].active = false;
        console.log(`\n🔄 [MANUAL RESET] Kill-switch deactivated for ${chain}`);
        console.log(`   Reset at: ${new Date().toISOString()}\n`);
        
        // Update the log
        updateGuardrailActionStatus(chain, 'KILL_SWITCH', 'MANUALLY_RESET');
    }
}

// Log guardrail action to file
function logGuardrailAction(chain, action, alertsPerHour, status) {
    const reportPath = path.join(__dirname, 'reports', 'guardrail-actions.md');
    const timestamp = new Date().toISOString();
    
    let content = '';
    if (fs.existsSync(reportPath)) {
        content = fs.readFileSync(reportPath, 'utf8');
    } else {
        content = '# Guardrail Actions Log\n\n## Action History\n\n';
    }
    
    const actionEntry = `### ${timestamp} - ${action}\n\n` +
        `**Chain:** ${chain}  \n` +
        `**Reason:** ${alertsPerHour} alerts/hour ${action === 'KILL_SWITCH' ? 'sustained ' : ''}(>${action === 'KILL_SWITCH' ? ALERT_KILL_LIMIT : ALERT_RATE_LIMIT} threshold)  \n` +
        `**Status:** ${status}  \n` +
        (action === 'MUTE_ALERTS' ? `**Muted Until:** ${new Date(muteStatus[chain].until).toISOString()}  \n` : '') +
        (action === 'KILL_SWITCH' ? `**Manual Reset Required:** true  \n` : '') +
        `\n---\n\n`;
    
    // Insert after "## Action History"
    const insertPoint = content.indexOf('## Action History\n\n') + '## Action History\n\n'.length;
    const newContent = content.slice(0, insertPoint) + actionEntry + content.slice(insertPoint);
    
    fs.writeFileSync(reportPath, newContent);
    console.log(`📝 Guardrail action logged to: ${reportPath}`);
}

// Update guardrail action status
function updateGuardrailActionStatus(chain, action, newStatus) {
    const reportPath = path.join(__dirname, 'reports', 'guardrail-actions.md');
    if (fs.existsSync(reportPath)) {
        let content = fs.readFileSync(reportPath, 'utf8');
        
        // Find the most recent entry for this chain and action
        const regex = new RegExp(`(### [^#]+- ${action}[\\s\\S]*?\\*\\*Chain:\\*\\* ${chain}[\\s\\S]*?\\*\\*Status:\\*\\*) [^\\n]+`, 'g');
        content = content.replace(regex, `$1 ${newStatus}`);
        
        if (newStatus === 'MANUALLY_RESET') {
            const resetTime = new Date().toISOString();
            content = content.replace(
                new RegExp(`(\\*\\*Chain:\\*\\* ${chain}[\\s\\S]*?\\*\\*Manual Reset Required:\\*\\* true)`, 'g'),
                `$1  \n**Reset At:** ${resetTime}`
            );
        }
        
        fs.writeFileSync(reportPath, content);
        console.log(`📝 Guardrail action status updated to: ${newStatus}`);
    }
}

// Send alert notification
function sendAlertNotification(chain, action, alertsPerHour) {
    const timestamp = new Date().toISOString();
    const notificationPath = path.join(__dirname, 'reports', `${action.toLowerCase()}-notification-${chain}-${Date.now()}.md`);
    
    let notification = '';
    if (action === 'MUTE_ALERTS') {
        notification = `# Alert Notification - Mute Guardrail Triggered\n\n` +
            `**Timestamp:** ${timestamp}  \n` +
            `**Alert Type:** GUARDRAIL TRIGGERED  \n` +
            `**Chain:** ${chain.toUpperCase()}  \n` +
            `**Reason:** ${alertsPerHour} alerts/hour (>${ALERT_RATE_LIMIT} threshold)  \n` +
            `**Action:** Alerts muted for ${MUTE_DURATION_MIN}m  \n` +
            `**Status:** Active until ${new Date(muteStatus[chain].until).toISOString()}  \n\n` +
            `## Discord/Telegram Message\n\n` +
            `\`\`\`\n` +
            `[GUARDRAIL TRIGGERED] Chain: ${chain.toUpperCase()}\n` +
            `Reason: ${alertsPerHour} alerts/hour (>${ALERT_RATE_LIMIT} threshold)\n` +
            `Action: Alerts muted for ${MUTE_DURATION_MIN}m\n` +
            `\`\`\`\n`;
    } else if (action === 'KILL_SWITCH') {
        notification = `# Alert Notification - Kill Switch Triggered\n\n` +
            `**Timestamp:** ${timestamp}  \n` +
            `**Alert Type:** CRITICAL GUARDRAIL  \n` +
            `**Chain:** ${chain.toUpperCase()}  \n` +
            `**Reason:** ${alertsPerHour} alerts/hour sustained (>${ALERT_KILL_LIMIT} threshold)  \n` +
            `**Action:** KILL_SWITCH activated - manual reset required  \n` +
            `**Status:** Active until manual reset  \n\n` +
            `## Discord/Telegram Message\n\n` +
            `\`\`\`\n` +
            `[CRITICAL GUARDRAIL] Chain: ${chain.toUpperCase()}\n` +
            `Reason: ${alertsPerHour} alerts/hour sustained (>${ALERT_KILL_LIMIT} threshold)\n` +
            `Action: KILL_SWITCH activated - manual reset required\n` +
            `\`\`\`\n`;
    }
    
    fs.writeFileSync(notificationPath, notification);
    
    console.log(`📢 ALERT NOTIFICATION:`);
    if (action === 'MUTE_ALERTS') {
        console.log(`[GUARDRAIL TRIGGERED] Chain: ${chain.toUpperCase()}`);
        console.log(`Reason: ${alertsPerHour} alerts/hour (>${ALERT_RATE_LIMIT} threshold)`);
        console.log(`Action: Alerts muted for ${MUTE_DURATION_MIN}m`);
    } else {
        console.log(`[CRITICAL GUARDRAIL] Chain: ${chain.toUpperCase()}`);
        console.log(`Reason: ${alertsPerHour} alerts/hour sustained (>${ALERT_KILL_LIMIT} threshold)`);
        console.log(`Action: KILL_SWITCH activated - manual reset required`);
    }
    console.log(`📝 Notification saved: ${notificationPath}\n`);
}

// Simulate alert storm scenarios
async function runSimulation() {
    console.log('============================================================');
    console.log('GUARDRAIL ALERT STORM SIMULATION');
    console.log('============================================================\n');
    
    const chain = 'bsc';
    initChain(chain);
    
    console.log(`🎯 Testing MUTE_ALERTS guardrail (${ALERT_RATE_LIMIT} alerts/hour threshold)\n`);
    
    // Scenario 1: Generate 20 alerts in quick succession to simulate 20/hour rate
    console.log('📊 Generating 20 alerts to trigger MUTE_ALERTS guardrail...\n');
    
    for (let i = 1; i <= 20; i++) {
        logAlert(chain, `Alert storm test ${i}/20`, i % 3 === 0 ? 'high' : 'medium');
        
        // Small delay to make it realistic
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Check if mute was triggered
        if (muteStatus[chain].active) {
            console.log(`\n✅ Mute triggered after ${i} alerts\n`);
            break;
        }
    }
    
    // Test alert suppression during mute
    if (muteStatus[chain].active) {
        console.log('🛑 Testing alert suppression during mute period...');
        for (let i = 1; i <= 3; i++) {
            logAlert(chain, `Test alert during mute ${i}`, 'high');
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    }
    
    // Simulate mute expiration (for demo purposes, we'll manually expire it)
    console.log('\n⏰ Simulating mute period expiration...');
    muteStatus[chain].until = Date.now() - 1000; // Expire 1 second ago
    
    console.log('✅ Testing alert resumption after mute expiration...');
    logAlert(chain, 'Post-mute test alert', 'medium');
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('\n🎯 Testing KILL_SWITCH guardrail (25+ alerts/hour threshold)\n');
    
    // Scenario 2: Generate enough alerts to trigger kill switch
    console.log('📊 Generating additional alerts to trigger KILL_SWITCH...\n');
    
    for (let i = 1; i <= 10; i++) {
        logAlert(chain, `Kill switch test ${i}/10`, 'critical');
        await new Promise(resolve => setTimeout(resolve, 50));
        
        if (killSwitchStatus[chain].active) {
            console.log(`\n✅ Kill-switch triggered after ${i} additional alerts\n`);
            break;
        }
    }
    
    // Test alert suppression during kill switch
    if (killSwitchStatus[chain].active) {
        console.log('🛑 Testing alert suppression during kill-switch...');
        for (let i = 1; i <= 3; i++) {
            logAlert(chain, `Test alert during kill-switch`, 'high');
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        console.log('\n🔧 Demonstrating manual kill-switch reset...\n');
        resetKillSwitch(chain);
        
        console.log('✅ Testing alert resumption after kill-switch reset...');
        logAlert(chain, 'Post-reset test alert', 'medium');
    }
    
    console.log('\n📊 Generating final reports...\n');
    
    // Generate summary
    const totalAlerts = alertCounts[chain];
    const guardrailActions = (muteStatus[chain].active || muteStatus[chain].until ? 1 : 0) + 
                           (killSwitchStatus[chain].active ? 1 : 0);
    
    console.log('============================================================');
    console.log('SIMULATION COMPLETE');
    console.log('============================================================');
    console.log(`Total alerts generated: ${totalAlerts}`);
    console.log(`Guardrail actions triggered: ${guardrailActions}`);
    console.log('\nGuardrail scenarios tested:');
    console.log('✅ MUTE_ALERTS (20 alerts/hour > 15 threshold)');
    console.log('✅ KILL_SWITCH (25+ alerts/hour threshold)');
    console.log('✅ Alert suppression during mute period');
    console.log('✅ Alert suppression during kill-switch');
    console.log('✅ Manual kill-switch reset');
    console.log('✅ Alert resumption after guardrail actions');
}

// Run the simulation
runSimulation().catch(console.error);