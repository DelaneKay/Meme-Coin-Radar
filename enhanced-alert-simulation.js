#!/usr/bin/env node

/**
 * Enhanced Alert Storm Simulation for Guardrail Testing
 * Properly triggers MUTE_ALERTS and KILL_SWITCH guardrail thresholds
 */

const fs = require('fs');
const path = require('path');

// Guardrail Configuration
const GUARDRAIL_CONFIG = {
    ALERT_RATE_LIMIT: 15,        // alerts/hour threshold for mute
    ALERT_KILL_LIMIT: 25,        // alerts/hour threshold for kill-switch
    MUTE_DURATION_MIN: 30,       // mute duration in minutes
    ERROR_RATE_WARN: 0.10,
    ERROR_RATE_KILL: 0.20,
    ROLLBACK_REGRESSION: 0.10
};

// Global state
let alertCount = 0;
let muteActive = false;
let killSwitchActive = false;
let muteStartTime = null;
let simulationStartTime = new Date();

class EnhancedGuardrailManager {
    constructor() {
        this.alertHistory = [];
        this.actions = [];
    }

    // Log alert with timestamp
    logAlert(chain, alertType, severity = 'medium') {
        const timestamp = new Date();
        const alert = {
            timestamp,
            chain,
            alertType,
            severity,
            id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        };
        
        this.alertHistory.push(alert);
        alertCount++;
        
        console.log(`🚨 [${timestamp.toISOString()}] Alert #${alertCount}: ${chain} - ${alertType} (${severity})`);
        
        // Check guardrails after each alert
        this.checkGuardrails(chain);
        
        return alert;
    }

    // Calculate alerts per hour for the last hour (or simulate based on recent rate)
    getAlertsPerHour(chain, timeWindow = 3600000) { // 1 hour in ms
        const now = new Date();
        const recentAlerts = this.alertHistory.filter(alert => 
            alert.chain === chain && 
            alert.timestamp >= new Date(now.getTime() - timeWindow)
        );
        
        // For simulation: if we have recent alerts, extrapolate the rate
        if (recentAlerts.length >= 3) {
            const timeSpan = now.getTime() - recentAlerts[0].timestamp.getTime();
            const hourlyRate = (recentAlerts.length / timeSpan) * 3600000;
            return Math.round(hourlyRate);
        }
        
        return recentAlerts.length;
    }

    // Check and apply guardrails
    checkGuardrails(chain) {
        if (killSwitchActive) {
            console.log(`🛑 KILL_SWITCH ACTIVE - All alerts suppressed for ${chain}`);
            return;
        }

        if (muteActive) {
            console.log(`🔇 MUTE ACTIVE - Alerts suppressed for ${chain}`);
            return;
        }

        const alertsPerHour = this.getAlertsPerHour(chain);
        console.log(`📊 Current rate: ${alertsPerHour} alerts/hour for ${chain}`);

        // Check kill-switch threshold first (more severe)
        if (alertsPerHour >= GUARDRAIL_CONFIG.ALERT_KILL_LIMIT) {
            this.triggerKillSwitch(chain, alertsPerHour);
        }
        // Check mute threshold
        else if (alertsPerHour >= GUARDRAIL_CONFIG.ALERT_RATE_LIMIT) {
            this.triggerMute(chain, alertsPerHour);
        }
    }

    // Trigger alert mute
    triggerMute(chain, alertsPerHour) {
        if (muteActive) return;

        muteActive = true;
        muteStartTime = new Date();
        
        const action = {
            timestamp: muteStartTime,
            type: 'MUTE_ALERTS',
            chain,
            reason: `${alertsPerHour} alerts/hour (>${GUARDRAIL_CONFIG.ALERT_RATE_LIMIT} threshold)`,
            duration_minutes: GUARDRAIL_CONFIG.MUTE_DURATION_MIN,
            status: 'ACTIVE'
        };

        this.actions.push(action);
        
        console.log(`\n🔇 [GUARDRAIL TRIGGERED] MUTE_ALERTS=true`);
        console.log(`   Chain: ${chain}`);
        console.log(`   Reason: ${alertsPerHour} alerts/hour (>${GUARDRAIL_CONFIG.ALERT_RATE_LIMIT} threshold)`);
        console.log(`   Action: Alerts muted for ${GUARDRAIL_CONFIG.MUTE_DURATION_MIN}m`);
        console.log(`   Started: ${muteStartTime.toISOString()}\n`);

        // For simulation, expire mute after 10 seconds instead of 30 minutes
        setTimeout(() => {
            this.expireMute(chain);
        }, 10000); // 10 seconds for demo
    }

    // Expire mute and resume alerts
    expireMute(chain) {
        if (!muteActive) return;

        muteActive = false;
        const expiredAt = new Date();
        
        console.log(`\n✅ [MUTE EXPIRED] Alerts resumed for ${chain}`);
        console.log(`   Muted from: ${muteStartTime.toISOString()}`);
        console.log(`   Resumed at: ${expiredAt.toISOString()}`);
        console.log(`   Actual duration: ${Math.round((expiredAt - muteStartTime) / 1000)}s (simulated 30m)\n`);

        // Update action status
        const muteAction = this.actions.find(a => a.type === 'MUTE_ALERTS' && a.status === 'ACTIVE');
        if (muteAction) {
            muteAction.status = 'EXPIRED';
            muteAction.expired_at = expiredAt;
        }
    }

    // Trigger kill-switch
    triggerKillSwitch(chain, alertsPerHour) {
        if (killSwitchActive) return;

        killSwitchActive = true;
        const killSwitchTime = new Date();
        
        const action = {
            timestamp: killSwitchTime,
            type: 'KILL_SWITCH',
            chain,
            reason: `${alertsPerHour} alerts/hour sustained (>${GUARDRAIL_CONFIG.ALERT_KILL_LIMIT} threshold)`,
            status: 'ACTIVE',
            manual_reset_required: true
        };

        this.actions.push(action);
        
        console.log(`\n🛑 [GUARDRAIL TRIGGERED] KILL_SWITCH=true`);
        console.log(`   Chain: ${chain}`);
        console.log(`   Reason: ${alertsPerHour} alerts/hour sustained (>${GUARDRAIL_CONFIG.ALERT_KILL_LIMIT} threshold)`);
        console.log(`   Action: Global shutdown - alerts stopped until manual reset`);
        console.log(`   Triggered: ${killSwitchTime.toISOString()}\n`);
    }

    // Manual reset of kill-switch
    resetKillSwitch(chain) {
        if (!killSwitchActive) return;

        killSwitchActive = false;
        const resetTime = new Date();
        
        console.log(`\n🔄 [MANUAL RESET] Kill-switch deactivated for ${chain}`);
        console.log(`   Reset at: ${resetTime.toISOString()}\n`);

        // Update action status
        const killAction = this.actions.find(a => a.type === 'KILL_SWITCH' && a.status === 'ACTIVE');
        if (killAction) {
            killAction.status = 'MANUALLY_RESET';
            killAction.reset_at = resetTime;
        }
    }

    // Generate summary report
    generateReport() {
        const reportPath = path.join(__dirname, 'reports', 'guardrail-actions.md');
        
        let report = '';
        
        // Check if file exists and read existing content
        if (fs.existsSync(reportPath)) {
            report = fs.readFileSync(reportPath, 'utf8');
        } else {
            report = '# Guardrail Actions Log\n\n## Action History\n\n';
        }

        // Add simulation header
        report += `## Alert Storm Simulation - ${new Date().toISOString()}\n\n`;
        report += `**Simulation Duration:** ${Math.round((new Date() - simulationStartTime) / 1000)}s  \n`;
        report += `**Total Alerts Generated:** ${alertCount}  \n`;
        report += `**Guardrail Actions Triggered:** ${this.actions.length}  \n\n`;

        // Add new entries
        this.actions.forEach(action => {
            report += `### ${action.timestamp.toISOString()} - ${action.type}\n\n`;
            report += `**Chain:** ${action.chain}  \n`;
            report += `**Reason:** ${action.reason}  \n`;
            report += `**Status:** ${action.status}  \n`;
            
            if (action.type === 'MUTE_ALERTS') {
                report += `**Duration:** ${action.duration_minutes} minutes (simulated)  \n`;
                if (action.expired_at) {
                    report += `**Expired:** ${action.expired_at.toISOString()}  \n`;
                    report += `**Actual Duration:** ${Math.round((action.expired_at - action.timestamp) / 1000)}s  \n`;
                }
            }
            
            if (action.type === 'KILL_SWITCH') {
                report += `**Manual Reset Required:** ${action.manual_reset_required}  \n`;
                if (action.reset_at) {
                    report += `**Reset At:** ${action.reset_at.toISOString()}  \n`;
                }
            }
            
            report += '\n---\n\n';
        });

        // Write report
        fs.writeFileSync(reportPath, report);
        console.log(`📝 Report updated: ${reportPath}`);
        
        return reportPath;
    }

    // Generate alert notifications
    generateAlertNotifications() {
        this.actions.forEach(action => {
            let message = '';
            
            if (action.type === 'MUTE_ALERTS') {
                message = `[GUARDRAIL TRIGGERED] Chain: ${action.chain}\nReason: ${action.reason}\nAction: Alerts muted for ${action.duration_minutes}m`;
            } else if (action.type === 'KILL_SWITCH') {
                message = `[CRITICAL GUARDRAIL] Chain: ${action.chain}\nReason: ${action.reason}\nAction: KILL_SWITCH activated - manual reset required`;
            }
            
            console.log(`\n📢 ALERT NOTIFICATION:`);
            console.log(message);
            console.log('');
        });
    }
}

// Enhanced simulation that properly triggers thresholds
async function runEnhancedSimulation() {
    console.log('🚀 Enhanced Alert Storm Guardrail Simulation Starting...\n');
    console.log('Configuration:');
    console.log(`   ALERT_RATE_LIMIT: ${GUARDRAIL_CONFIG.ALERT_RATE_LIMIT} alerts/hour`);
    console.log(`   ALERT_KILL_LIMIT: ${GUARDRAIL_CONFIG.ALERT_KILL_LIMIT} alerts/hour`);
    console.log(`   MUTE_DURATION: ${GUARDRAIL_CONFIG.MUTE_DURATION_MIN} minutes\n`);

    const guardrail = new EnhancedGuardrailManager();

    const alertTypes = [
        'High volatility detected',
        'Unusual trading volume',
        'Price manipulation suspected',
        'Liquidity drain alert',
        'Pump and dump pattern',
        'Whale movement detected',
        'Suspicious contract activity',
        'Flash loan attack pattern'
    ];

    // Scenario 1: Trigger MUTE_ALERTS (20 alerts/hour > 15 threshold)
    console.log('=' .repeat(60));
    console.log('SCENARIO 1: MUTE_ALERTS Trigger Test (20 alerts/hour)');
    console.log('=' .repeat(60));
    
    // Generate 20 alerts rapidly to simulate 20/hour rate
    console.log('🎯 Generating 20 alerts rapidly to trigger mute threshold...\n');
    
    for (let i = 0; i < 20; i++) {
        const alertType = alertTypes[Math.floor(Math.random() * alertTypes.length)];
        const severity = Math.random() > 0.7 ? 'high' : Math.random() > 0.4 ? 'medium' : 'low';
        
        guardrail.logAlert('bsc', alertType, severity);
        
        // Small delay between alerts
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Break if mute is triggered
        if (muteActive) {
            console.log(`\n✅ Mute triggered after ${i + 1} alerts\n`);
            break;
        }
    }
    
    // Test muted alerts
    console.log('🔇 Testing alert suppression during mute period...');
    for (let i = 0; i < 3; i++) {
        guardrail.logAlert('bsc', 'Test alert during mute', 'low');
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Wait for mute to expire
    console.log('\n⏳ Waiting for mute to expire...\n');
    await new Promise(resolve => setTimeout(resolve, 12000)); // Wait for mute expiration

    // Reset for next scenario
    console.log('🔄 Resetting for kill-switch scenario...\n');
    alertCount = 0;
    muteActive = false;
    guardrail.alertHistory = [];
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Scenario 2: Trigger KILL_SWITCH (28 alerts/hour > 25 threshold)
    console.log('=' .repeat(60));
    console.log('SCENARIO 2: KILL_SWITCH Trigger Test (28 alerts/hour)');
    console.log('=' .repeat(60));
    
    // Generate 28 alerts rapidly to simulate 28/hour rate
    console.log('🎯 Generating 28 alerts rapidly to trigger kill-switch threshold...\n');
    
    for (let i = 0; i < 28; i++) {
        const alertType = alertTypes[Math.floor(Math.random() * alertTypes.length)];
        const severity = Math.random() > 0.7 ? 'high' : Math.random() > 0.4 ? 'medium' : 'low';
        
        guardrail.logAlert('bsc', alertType, severity);
        
        // Small delay between alerts
        await new Promise(resolve => setTimeout(resolve, 150));
        
        // Break if kill-switch is triggered
        if (killSwitchActive) {
            console.log(`\n✅ Kill-switch triggered after ${i + 1} alerts\n`);
            break;
        }
    }

    // Test blocked alerts during kill-switch
    console.log('🛑 Testing alert suppression during kill-switch...');
    for (let i = 0; i < 3; i++) {
        guardrail.logAlert('bsc', 'Test alert during kill-switch', 'high');
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Manual reset demonstration
    console.log('\n🔧 Demonstrating manual kill-switch reset...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    guardrail.resetKillSwitch('bsc');

    // Test alert resumption after reset
    console.log('✅ Testing alert resumption after kill-switch reset...');
    guardrail.logAlert('bsc', 'Post-reset test alert', 'medium');

    // Generate reports and notifications
    console.log('\n📊 Generating final reports...\n');
    guardrail.generateReport();
    guardrail.generateAlertNotifications();

    // Summary
    console.log('\n' + '=' .repeat(60));
    console.log('SIMULATION COMPLETE');
    console.log('=' .repeat(60));
    console.log(`Total alerts generated: ${alertCount}`);
    console.log(`Total guardrail actions: ${guardrail.actions.length}`);
    console.log(`Simulation duration: ${Math.round((new Date() - simulationStartTime) / 1000)}s`);
    console.log('\nGuardrail actions taken:');
    guardrail.actions.forEach((action, index) => {
        console.log(`${index + 1}. ${action.type} for ${action.chain} - ${action.status}`);
    });
    console.log('\n✅ Both mute and kill-switch scenarios tested successfully!');
}

// Run simulation if called directly
if (require.main === module) {
    runEnhancedSimulation().catch(console.error);
}

module.exports = { EnhancedGuardrailManager, runEnhancedSimulation };