# Guardrail Actions Log

## Action History

### 2025-09-25T23:04:35.322Z - KILL_SWITCH

**Chain:** bsc  
**Reason:** 32 alerts/hour sustained (>25 threshold)  
**Status:** ACTIVE  
**Manual Reset Required:** true  

---

### 2025-09-25T23:04:34.615Z - KILL_SWITCH

**Chain:** bsc  
**Reason:** 26 alerts/hour sustained (>25 threshold)  
**Status:** MANUALLY_RESET
**Manual Reset Required:** true  
**Reset At:** 2025-09-25T23:04:35.316Z  

---

### 2025-09-25T23:03:24.266Z - MUTE_ALERTS

**Chain:** bsc  
**Reason:** 20 alerts/hour (>15 threshold)  
**Status:** ACTIVE  
**Muted Until:** 2025-09-25T23:33:24.264Z  

---

### 2025-09-25T23:03:23.404Z - MUTE_ALERTS

**Chain:** bsc  
**Reason:** 16 alerts/hour (>15 threshold)  
**Status:** ACTIVE  
**Muted Until:** 2025-09-25T23:33:23.396Z  

---

## Alert Storm Simulation - 2025-09-25T23:02:04.140Z

**Simulation Duration:** 24s  
**Total Alerts Generated:** 5  
**Guardrail Actions Triggered:** 2  

### 2025-09-25T23:01:40.152Z - KILL_SWITCH

**Chain:** bsc  
**Reason:** 25899 alerts/hour sustained (>25 threshold)  
**Status:** MANUALLY_RESET
**Manual Reset Required:** true  
**Reset At:** 2025-09-25T23:04:35.316Z  
**Reset At:** 2025-09-25T23:02:04.133Z  

---

### 2025-09-25T23:02:04.136Z - KILL_SWITCH

**Chain:** bsc  
**Reason:** 3827 alerts/hour sustained (>25 threshold)  
**Status:** MANUALLY_RESET
**Manual Reset Required:** true  
**Reset At:** 2025-09-25T23:04:35.316Z  

---

## MUTE_ALERTS - 2025-09-26T11:44:59.629Z

**ID:** `mute_alerts-1758887099628`  
**Chain:** bsc  
**Reason:** [DRY RUN] Alert rate exceeded - 18 alerts/hour > 15 threshold  
**Duration:** 30 minutes  

### Details
```json
{
  "dryRun": true,
  "alertsPerHour": 18,
  "threshold": 15,
  "action": "auto_mute",
  "triggerTime": "2025-09-26T11:44:59.627Z"
}
```

### Discord/Telegram Message
```
[GUARDRAIL TRIGGERED] Chain: BSC
Reason: [DRY RUN] Alert rate exceeded - 18 alerts/hour > 15 threshold
Action: MUTE ALERTS for 30m
```

---

## KILL_SWITCH - 2025-09-26T11:45:00.020Z

**ID:** `kill_switch-1758887100020`  
**Chain:** eth  
**Reason:** [DRY RUN] Sustained alert storm - 27 alerts/hour for 15+ minutes > 25 threshold  


### Details
```json
{
  "dryRun": true,
  "alertsPerHour": 27,
  "threshold": 25,
  "sustainedMinutes": 15,
  "action": "kill_switch",
  "triggerTime": "2025-09-26T11:45:00.020Z"
}
```

### Discord/Telegram Message
```
[GUARDRAIL TRIGGERED] Chain: ETH
Reason: [DRY RUN] Sustained alert storm - 27 alerts/hour for 15+ minutes > 25 threshold
Action: KILL SWITCH
```

---

## BACKOFF_COLLECTORS - 2025-09-26T11:45:00.029Z

**ID:** `backoff_collectors-1758887100029`  
**Chain:** Global  
**Reason:** [DRY RUN] High error rate - 12% > 10% threshold for 5+ minutes  
**Duration:** 60 minutes  

### Details
```json
{
  "dryRun": true,
  "errorRate": 0.12,
  "threshold": 0.1,
  "backoffPercentage": 50,
  "sustainedMinutes": 5,
  "action": "backoff_collectors",
  "triggerTime": "2025-09-26T11:45:00.029Z"
}
```

### Discord/Telegram Message
```
[GUARDRAIL TRIGGERED] Global
Reason: [DRY RUN] High error rate - 12% > 10% threshold for 5+ minutes
Action: BACKOFF COLLECTORS for 60m
```

---

## KILL_SWITCH - 2025-09-26T11:45:00.034Z

**ID:** `kill_switch-1758887100034`  
**Chain:** Global  
**Reason:** [DRY RUN] Critical error rate - 22% > 20% threshold for 15+ minutes  


### Details
```json
{
  "dryRun": true,
  "errorRate": 0.22,
  "threshold": 0.2,
  "sustainedMinutes": 15,
  "action": "error_kill_switch",
  "triggerTime": "2025-09-26T11:45:00.034Z"
}
```

### Discord/Telegram Message
```
[GUARDRAIL TRIGGERED] Global
Reason: [DRY RUN] Critical error rate - 22% > 20% threshold for 15+ minutes
Action: KILL SWITCH
```

---

## ROLLBACK_TUNING - 2025-09-26T11:45:00.040Z

**ID:** `rollback_tuning-1758887100040`  
**Chain:** Global  
**Reason:** [DRY RUN] Tuning regression detected - F1 score dropped 12% > 10% threshold  


### Details
```json
{
  "dryRun": true,
  "f1Drop": 0.12,
  "threshold": 0.1,
  "previousF1": 0.85,
  "currentF1": 0.73,
  "action": "auto_rollback",
  "triggerTime": "2025-09-26T11:45:00.040Z"
}
```

### Discord/Telegram Message
```
[GUARDRAIL TRIGGERED] Global
Reason: [DRY RUN] Tuning regression detected - F1 score dropped 12% > 10% threshold
Action: ROLLBACK TUNING
```

---

## KILL_SWITCH - 2025-09-26T11:45:00.066Z

**ID:** `kill_switch-1758887100066`  
**Chain:** Global  
**Reason:** [DRY RUN] Manual emergency shutdown - operator initiated  


### Details
```json
{
  "dryRun": true,
  "manual": true,
  "operator": "admin",
  "action": "manual_kill_switch",
  "triggerTime": "2025-09-26T11:45:00.066Z"
}
```

### Discord/Telegram Message
```
[GUARDRAIL TRIGGERED] Global
Reason: [DRY RUN] Manual emergency shutdown - operator initiated
Action: KILL SWITCH
```

---

## KILL_SWITCH - 2025-09-26T11:45:00.071Z

**ID:** `kill_switch-1758887100071`  
**Chain:** sol  
**Reason:** [DRY RUN] Manual kill-switch reset - system verified stable  


### Details
```json
{
  "dryRun": true,
  "manual": true,
  "operator": "admin",
  "action": "reset_kill_switch",
  "triggerTime": "2025-09-26T11:45:00.071Z"
}
```

### Discord/Telegram Message
```
[GUARDRAIL TRIGGERED] Chain: SOL
Reason: [DRY RUN] Manual kill-switch reset - system verified stable
Action: KILL SWITCH
```

---

