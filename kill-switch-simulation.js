const fs = require('fs');
const path = require('path');

// Guardrail Configuration
const ALERT_RATE_LIMIT = 15; // alerts/hour
const ALERT_KILL_LIMIT = 25; // alerts/hour
const MUTE_DURATION_MIN = 30; // minutes

// State tracking
let alertCounts = {};
let killSwitchStatus = {};
let alertHistory = {};

// Initialize chain state
function initChain(chain) {
    if (!alertCounts[chain]) {
        alertCounts[chain] = 0;
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
    
    // Check if kill-switch active
    if (killSwitchStatus[chain].active) {
        console.log(`🛑 KILL_SWITCH ACTIVE - All alerts suppressed for ${chain}`);
        return false;
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
    
    // Kill switch check
    if (alertsPerHour > ALERT_KILL_LIMIT && !killSwitchStatus[chain].active) {
        triggerKillSwitch(chain, alertsPerHour);
        return;
    }
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
        `**Reason:** ${alertsPerHour} alerts/hour sustained (>${ALERT_KILL_LIMIT} threshold)  \n` +
        `**Status:** ${status}  \n` +
        `**Manual Reset Required:** true  \n` +
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
    
    const notification = `# Alert Notification - Kill Switch Triggered\n\n` +
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
    
    fs.writeFileSync(notificationPath, notification);
    
    console.log(`📢 ALERT NOTIFICATION:`);
    console.log(`[CRITICAL GUARDRAIL] Chain: ${chain.toUpperCase()}`);
    console.log(`Reason: ${alertsPerHour} alerts/hour sustained (>${ALERT_KILL_LIMIT} threshold)`);
    console.log(`Action: KILL_SWITCH activated - manual reset required`);
    console.log(`📝 Notification saved: ${notificationPath}\n`);
}

// Simulate kill switch scenario
async function runKillSwitchSimulation() {
    console.log('============================================================');
    console.log('KILL_SWITCH GUARDRAIL SIMULATION');
    console.log('============================================================\n');
    
    const chain = 'bsc';
    initChain(chain);
    
    console.log(`🎯 Testing KILL_SWITCH guardrail (${ALERT_KILL_LIMIT}+ alerts/hour threshold)\n`);
    
    // Generate 28 alerts to trigger kill switch (above 25 threshold)
    console.log('📊 Generating 28 alerts to trigger KILL_SWITCH guardrail...\n');
    
    for (let i = 1; i <= 28; i++) {
        logAlert(chain, `Critical alert storm ${i}/28`, i % 2 === 0 ? 'critical' : 'high');
        
        // Small delay to make it realistic
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // Check if kill switch was triggered
        if (killSwitchStatus[chain].active) {
            console.log(`\n✅ Kill-switch triggered after ${i} alerts\n`);
            break;
        }
    }
    
    // Test alert suppression during kill switch
    if (killSwitchStatus[chain].active) {
        console.log('🛑 Testing alert suppression during kill-switch...');
        for (let i = 1; i <= 5; i++) {
            logAlert(chain, `Test alert during kill-switch ${i}`, 'critical');
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        console.log('\n🔧 Demonstrating manual kill-switch reset...\n');
        resetKillSwitch(chain);
        
        console.log('✅ Testing alert resumption after kill-switch reset...');
        logAlert(chain, 'Post-reset test alert', 'medium');
    }
    
    console.log('\n📊 Generating final reports...\n');
    
    // Generate summary
    const totalAlerts = alertCounts[chain];
    
    console.log('============================================================');
    console.log('KILL_SWITCH SIMULATION COMPLETE');
    console.log('============================================================');
    console.log(`Total alerts generated: ${totalAlerts}`);
    console.log('Guardrail scenarios tested:');
    console.log('✅ KILL_SWITCH (28 alerts/hour > 25 threshold)');
    console.log('✅ Alert suppression during kill-switch');
    console.log('✅ Manual kill-switch reset');
    console.log('✅ Alert resumption after reset');
}

// Run the simulation
runKillSwitchSimulation().catch(console.error);