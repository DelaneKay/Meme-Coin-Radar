# Tuning Actions Log

## Action History

### 2025-09-25T22:53:26.191Z - BSC Proposal Applied

**Action:** Applied tuning proposal `proposal_bsc_1758840144232_1`  
**Chain:** BSC  
**Applied By:** Tuning Manager  
**Status:** SUCCESS  

**Applied Configuration:**
- SCORE_ALERT: 72
- SURGE15_MIN: 2.8
- IMBALANCE5_MIN: 0.40
- MIN_LIQ_ALERT: 30,000

**Metrics Snapshot at Application:**
- Precision: 0.705
- Recall: 0.615
- F1 Score: 0.655
- F1 Improvement: +30.0%
- Alerts per Hour: 6.2
- Shadow Testing Duration: 24 hours
- Total Signals Processed: 142
- Would Alert Count: 28

**Validation Results:**
- ✅ Shadow testing completed (≥24h)
- ✅ Precision ≥ 0.5 (0.705)
- ✅ F1 improvement ≥ 10% (+30.0%)
- ✅ Alerts/hour ≤ 10 (6.2)
- ✅ Orchestrator TUNING_CAN_APPLY=true

**Previous Configuration (for rollback):**
- SCORE_ALERT: 65
- SURGE15_MIN: 2.0
- IMBALANCE5_MIN: 0.30
- MIN_LIQ_ALERT: 20,000

---