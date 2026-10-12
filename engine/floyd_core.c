/*
 * ============================================================================
 *  FareGrid - Floyd-Warshall engine (C, compiled to WebAssembly)
 *  AOA Mini Project Sr. No. 17 - Intercity All-Pairs Travel Cost Analyzer
 *
 *  Same algorithm as ../console/floyd_warshall.c. Instead of reading from a
 *  console it works on static arrays that the web page fills and reads, and it
 *  records every stage and every update so the page can animate the run.
 *
 *  It uses no C library at all, so it compiles to a standalone .wasm file:
 *      ./build.sh            (produces ../public/floyd.wasm)
 *
 *  All matrices use a row stride of MAX: element (i, j) is at [i * MAX + j].
 *
 *  DP recurrence:
 *      D0[i][j] = cost[i][j]            (0 on diagonal, INF if no edge)
 *      Dk[i][j] = min( Dk-1[i][j], Dk-1[i][k] + Dk-1[k][j] )
 *
 *  Time complexity  : Theta(n^3)
 *  Space complexity : Theta(n^2)  (plus the recorded trace for animation)
 * ============================================================================
 */

#define MAX        20
#define INF        1000000000            /* "no edge" / unreachable          */
#define NEG_LIMIT  (-INF)                /* clamp for values in neg. cycles  */
#define COST_LIMIT 1000000               /* allowed |edge cost|              */

#define EXPORT(name) __attribute__((export_name(name)))
#define AT(m, i, j)  m[(i) * MAX + (j)]

static int n;
static int cost[MAX * MAX];              /* input cost matrix (page writes)   */
static int dist[MAX * MAX];              /* DP distance matrix                */
static int nxt[MAX * MAX];               /* next hop on cheapest route, -1    */
static int snap[MAX * MAX * MAX];        /* dist after each stage k           */
static int upd[MAX * MAX * MAX * 4];     /* every update: i, j, old, new      */
static int updStart[MAX];                /* first update index of stage k     */
static int updCount[MAX];                /* number of updates in stage k      */
static int affected[MAX * MAX];          /* 1 if pair passes a negative cycle */
static int stats[5];                     /* relaxTests, updates, edges,
                                            negEdges, negCycle                */

/* ------------------------- pointers for the page ------------------------ */
EXPORT("fw_max")       int  fw_max(void)       { return MAX; }
EXPORT("fw_inf")       int  fw_inf(void)       { return INF; }
EXPORT("fw_cost")      int *fw_cost(void)      { return cost; }
EXPORT("fw_dist")      int *fw_dist(void)      { return dist; }
EXPORT("fw_next")      int *fw_next(void)      { return nxt; }
EXPORT("fw_snap")      int *fw_snap(void)      { return snap; }
EXPORT("fw_upd")       int *fw_upd(void)       { return upd; }
EXPORT("fw_upd_start") int *fw_upd_start(void) { return updStart; }
EXPORT("fw_upd_count") int *fw_upd_count(void) { return updCount; }
EXPORT("fw_affected")  int *fw_affected(void)  { return affected; }
EXPORT("fw_stats")     int *fw_stats(void)     { return stats; }

/* A pair's cost is undefined (-infinity) if its path can pass a negative cycle. */
static int isPairAffected(int i, int j)
{
    int k;
    for (k = 0; k < n; k++)
        if (AT(dist, k, k) < 0 && AT(dist, i, k) < INF && AT(dist, k, j) < INF)
            return 1;
    return 0;
}

/*
 * Runs Floyd-Warshall on the first `count` rows/columns of cost[].
 * Returns 0 on success, -1 for an invalid city count, -2 for an invalid cost.
 */
EXPORT("fw_solve")
int fw_solve(int count)
{
    int i, j, k, s, total = 0, through;

    if (count < 1 || count > MAX) return -1;
    n = count;

    for (i = 0; i < n; i++)
        for (j = 0; j < n; j++) {
            int v = AT(cost, i, j);
            if (v != INF && (v > COST_LIMIT || v < -COST_LIMIT)) return -2;
        }

    /* Step 1 & 2: initialise dist and next matrices from the cost matrix */
    for (i = 0; i < n; i++) {
        AT(cost, i, i) = 0;
        for (j = 0; j < n; j++) {
            AT(dist, i, j) = AT(cost, i, j);
            AT(nxt, i, j)  = (AT(cost, i, j) < INF) ? j : -1;
        }
    }
    for (s = 0; s < 5; s++) stats[s] = 0;

    /* Step 3: consider each city k as an allowed intermediate point */
    for (k = 0; k < n; k++) {
        updStart[k] = total;
        updCount[k] = 0;
        for (i = 0; i < n; i++) {
            if (AT(dist, i, k) >= INF) continue;          /* i cannot reach k */
            for (j = 0; j < n; j++) {
                if (AT(dist, k, j) >= INF) continue;      /* k cannot reach j */
                stats[0]++;
                /* both operands lie in [-INF, INF), so the sum fits in int */
                through = AT(dist, i, k) + AT(dist, k, j);
                if (through < NEG_LIMIT) through = NEG_LIMIT;
                if (through < AT(dist, i, j)) {
                    int *u = &upd[total * 4];
                    u[0] = i; u[1] = j; u[2] = AT(dist, i, j); u[3] = through;
                    AT(dist, i, j) = through;
                    AT(nxt, i, j)  = AT(nxt, i, k);
                    total++;
                    updCount[k]++;
                }
            }
        }
        /* Step 4: keep the matrix after this stage for display */
        for (i = 0; i < n; i++)
            for (j = 0; j < n; j++)
                snap[k * MAX * MAX + i * MAX + j] = AT(dist, i, j);
    }
    stats[1] = total;

    /* Step 6: negative diagonal entries indicate a negative cycle */
    for (i = 0; i < n; i++) {
        if (AT(dist, i, i) < 0) stats[4] = 1;
        for (j = 0; j < n; j++)
            if (i != j && AT(cost, i, j) < INF) {
                stats[2]++;
                if (AT(cost, i, j) < 0) stats[3]++;
            }
    }
    for (i = 0; i < n; i++)
        for (j = 0; j < n; j++)
            AT(affected, i, j) = isPairAffected(i, j);

    return 0;
}
