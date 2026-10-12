/*
 * ============================================================================
 *  AOA Mini Project - Sr. No. 17
 *  Intercity All-Pairs Travel Cost Analyzer (Floyd-Warshall Algorithm)
 *  Module 4: Dynamic Programming Approach
 *
 *  Implementation : C (console, menu driven)
 *  GUI / Database : Not used
 *
 *  DP recurrence:
 *      D0[i][j] = cost[i][j]            (0 on diagonal, INF if no edge)
 *      Dk[i][j] = min( Dk-1[i][j], Dk-1[i][k] + Dk-1[k][j] )
 *
 *  Time complexity  : Theta(n^3)
 *  Space complexity : Theta(n^2)
 * ============================================================================
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>

#define MAX        20
#define NAME_LEN   30
#define LINE_LEN   512
#define INF        1000000000LL      /* "no edge" / unreachable          */
#define NEG_LIMIT  (-INF)            /* clamp for values in neg. cycles  */
#define COST_LIMIT 1000000           /* allowed |edge cost|              */

/* ---------------------------- global data ------------------------------- */
char      city[MAX][NAME_LEN];       /* city names                        */
int       n = 0;                     /* number of cities                  */
long long cost[MAX][MAX];            /* original input cost matrix        */
long long dist[MAX][MAX];            /* DP distance matrix                */
int       nxt[MAX][MAX];             /* next hop on shortest route, -1=none */

int dataLoaded  = 0;
int processed   = 0;
int hasNegCycle = 0;
long long updates    = 0;            /* successful relaxations            */
long long relaxTests = 0;            /* i->k->j checks performed          */

/* ------------------------- input helper functions ----------------------- */

/* Reads one line from stdin. Exits cleanly on end of input. */
void readLine(char *buf, int size)
{
    if (fgets(buf, size, stdin) == NULL) {
        printf("\n[End of input] Exiting.\n");
        exit(0);
    }
    buf[strcspn(buf, "\r\n")] = '\0';
}

/* Reads an integer in [lo, hi], re-prompting on invalid input. */
int readInt(const char *prompt, int lo, int hi)
{
    char buf[LINE_LEN], *end;
    long v;
    while (1) {
        printf("%s", prompt);
        readLine(buf, sizeof buf);
        v = strtol(buf, &end, 10);
        while (isspace((unsigned char)*end)) end++;
        if (end != buf && *end == '\0' && v >= lo && v <= hi)
            return (int)v;
        printf("  Invalid input. Enter an integer between %d and %d.\n", lo, hi);
    }
}

int equalsIgnoreCase(const char *a, const char *b)
{
    while (*a && *b) {
        if (tolower((unsigned char)*a) != tolower((unsigned char)*b)) return 0;
        a++; b++;
    }
    return *a == *b;
}

/* Returns 1 if token means "no edge" (INF / x / -). */
int isNoEdgeToken(const char *t)
{
    return equalsIgnoreCase(t, "INF") || equalsIgnoreCase(t, "x") ||
           strcmp(t, "-") == 0;
}

/* Parses a cost token. Returns 1 on success and stores value in *out. */
int parseCost(const char *t, long long *out)
{
    char *end;
    long v;
    if (isNoEdgeToken(t)) { *out = INF; return 1; }
    v = strtol(t, &end, 10);
    if (end == t || *end != '\0') return 0;
    if (v > COST_LIMIT || v < -COST_LIMIT) return 0;
    *out = v;
    return 1;
}

/* Lets the user pick a city by number (1..n) or by name. Returns index. */
int readCity(const char *prompt)
{
    char buf[LINE_LEN], *end;
    long v;
    int i;
    while (1) {
        printf("%s", prompt);
        readLine(buf, sizeof buf);
        v = strtol(buf, &end, 10);
        if (end != buf && *end == '\0' && v >= 1 && v <= n)
            return (int)v - 1;
        for (i = 0; i < n; i++)
            if (equalsIgnoreCase(buf, city[i])) return i;
        printf("  Unknown city. Enter a number 1-%d or a city name.\n", n);
    }
}

/* ------------------------------ display --------------------------------- */

void printLine(int width)
{
    int i;
    for (i = 0; i < width; i++) putchar('-');
    putchar('\n');
}

void printCities(void)
{
    int i;
    printf("\nCities (%d):\n", n);
    for (i = 0; i < n; i++)
        printf("  %2d. %s\n", i + 1, city[i]);
}

/* Prints an n x n cost/distance matrix with INF for missing values. */
void printMatrix(long long m[MAX][MAX], const char *title)
{
    int i, j;
    printf("\n%s\n", title);
    printLine(14 + 10 * n);
    printf("%-14s", "From \\ To");
    for (j = 0; j < n; j++) printf("%10.9s", city[j]);
    printf("\n");
    printLine(14 + 10 * n);
    for (i = 0; i < n; i++) {
        printf("%-14.13s", city[i]);
        for (j = 0; j < n; j++) {
            if (m[i][j] >= INF)            printf("%10s", "INF");
            else if (m[i][j] <= NEG_LIMIT) printf("%10s", "-INF");
            else                           printf("%10lld", m[i][j]);
        }
        printf("\n");
    }
    printLine(14 + 10 * n);
}

/* Prints next-hop matrix: entry = city number of the first hop from i to j. */
void printNextMatrix(void)
{
    int i, j;
    printf("\nNext-hop (route) matrix: entry = number of the first city to\n"
           "visit after the source on the cheapest route ('-' = no route)\n");
    printLine(14 + 6 * n);
    printf("%-14s", "From \\ To");
    for (j = 0; j < n; j++) printf("%6d", j + 1);
    printf("\n");
    printLine(14 + 6 * n);
    for (i = 0; i < n; i++) {
        printf("%2d.%-11.10s", i + 1, city[i]);
        for (j = 0; j < n; j++) {
            if (nxt[i][j] == -1) printf("%6s", "-");
            else                 printf("%6d", nxt[i][j] + 1);
        }
        printf("\n");
    }
    printLine(14 + 6 * n);
}

/* ---------------------------- data entry -------------------------------- */

void resetResults(void)
{
    processed   = 0;
    hasNegCycle = 0;
    updates     = 0;
    relaxTests  = 0;
}

void readGraph(void)
{
    char buf[LINE_LEN], *tok;
    long long row[MAX];
    int i, j, k, count, ok, dup;

    n = readInt("\nEnter number of cities (1-20): ", 1, MAX);

    for (i = 0; i < n; i++) {
        while (1) {
            printf("  Name of city %d: ", i + 1);
            readLine(buf, sizeof buf);
            if (buf[0] == '\0') { printf("  Name cannot be empty.\n"); continue; }
            buf[NAME_LEN - 1] = '\0';
            dup = 0;
            for (k = 0; k < i; k++)
                if (equalsIgnoreCase(buf, city[k])) dup = 1;
            if (dup) { printf("  City already entered. Use a unique name.\n"); continue; }
            strcpy(city[i], buf);
            break;
        }
    }

    printf("\nEnter the cost matrix row by row (%d values per row, space separated).\n", n);
    printf("Use INF, x or - for 'no direct road'. Negative costs (adjustments) are allowed.\n");
    printf("Diagonal (city to itself) is always taken as 0.\n");

    for (i = 0; i < n; i++) {
        while (1) {
            printf("  From %-12s: ", city[i]);
            readLine(buf, sizeof buf);
            count = 0;
            ok = 1;
            for (tok = strtok(buf, " \t,"); tok != NULL; tok = strtok(NULL, " \t,")) {
                if (count >= n || !parseCost(tok, &row[count])) { ok = 0; break; }
                count++;
            }
            if (!ok || count != n) {
                printf("  Invalid row. Enter exactly %d values (integers within +/-%d or INF).\n",
                       n, COST_LIMIT);
                continue;
            }
            break;
        }
        for (j = 0; j < n; j++) cost[i][j] = row[j];
        if (cost[i][i] != 0)
            printf("  Note: diagonal value for %s set to 0.\n", city[i]);
        cost[i][i] = 0;
    }

    dataLoaded = 1;
    resetResults();
    printf("\nGraph stored successfully.\n");
}

/* Fills cost matrix with INF and 0 diagonal. */
void clearCost(void)
{
    int i, j;
    for (i = 0; i < n; i++)
        for (j = 0; j < n; j++)
            cost[i][j] = (i == j) ? 0 : INF;
}

void setNames(const char *names[], int count)
{
    int i;
    n = count;
    for (i = 0; i < n; i++) {
        strncpy(city[i], names[i], NAME_LEN - 1);
        city[i][NAME_LEN - 1] = '\0';
    }
    clearCost();
}

void loadSample(void)
{
    int c;
    printf("\nSample datasets:\n");
    printf("  1. Maharashtra/Goa road network (positive costs)\n");
    printf("  2. Network with negative adjustments, no negative cycle (CLRS example)\n");
    printf("  3. Network containing a negative cycle\n");
    c = readInt("Choose sample (1-3): ", 1, 3);

    if (c == 1) {
        const char *names[] = {"Mumbai", "Pune", "Nashik", "Nagpur", "Goa"};
        setNames(names, 5);
        cost[0][1] = 150; cost[0][2] = 170; cost[0][4] = 590;  /* Mumbai */
        cost[1][0] = 150; cost[1][2] = 210; cost[1][3] = 700;  /* Pune   */
        cost[1][4] = 450;
        cost[2][0] = 170; cost[2][3] = 450;                    /* Nashik */
        cost[3][0] = 800;                                      /* Nagpur */
        cost[4][0] = 590; cost[4][1] = 450;                    /* Goa    */
    } else if (c == 2) {
        const char *names[] = {"Surat", "Vadodara", "Ahmedabad", "Rajkot", "Bhuj"};
        setNames(names, 5);
        cost[0][1] = 3;  cost[0][2] = 8;  cost[0][4] = -4;
        cost[1][3] = 1;  cost[1][4] = 7;
        cost[2][1] = 4;
        cost[3][0] = 2;  cost[3][2] = -5;
        cost[4][3] = 6;
    } else {
        const char *names[] = {"Delhi", "Agra", "Jaipur", "Udaipur", "Shimla"};
        setNames(names, 5);
        cost[0][1] = 4;                    /* Delhi  -> Agra    */
        cost[1][2] = -6;                   /* Agra   -> Jaipur  */
        cost[2][0] = 1;                    /* Jaipur -> Delhi   (cycle sum = -1) */
        cost[2][3] = 2;                    /* Jaipur -> Udaipur */
        cost[4][0] = 3;                    /* Shimla -> Delhi   */
    }

    dataLoaded = 1;
    resetResults();
    printf("\nSample %d loaded.\n", c);
    printCities();
    printMatrix(cost, "Input cost matrix D(0):");
}

/* ------------------------- Floyd-Warshall core -------------------------- */

void printStage(int k)
{
    char title[128];
    if (k < 0)
        snprintf(title, sizeof title, "D(0): initial matrix (no intermediate city)");
    else
        snprintf(title, sizeof title, "D(%d): after allowing %s as intermediate city",
                 k + 1, city[k]);
    printMatrix(dist, title);
}

/*
 * traceMode: 0 = no trace, 1 = print every stage, 2 = print selected stages
 * showStage[k] is used only when traceMode == 2.
 */
void floydWarshall(int traceMode, const int showStage[])
{
    int i, j, k;
    long long through;

    /* Step 1 & 2: initialise dist and next matrices from the cost matrix */
    for (i = 0; i < n; i++) {
        for (j = 0; j < n; j++) {
            dist[i][j] = cost[i][j];
            nxt[i][j]  = (cost[i][j] < INF) ? j : -1;
        }
        dist[i][i] = 0;
        nxt[i][i]  = i;
    }
    updates = relaxTests = 0;

    if (traceMode != 0) printStage(-1);

    /* Step 3: consider each city k as an allowed intermediate point */
    for (k = 0; k < n; k++) {
        for (i = 0; i < n; i++) {
            if (dist[i][k] >= INF) continue;          /* i cannot reach k */
            for (j = 0; j < n; j++) {
                if (dist[k][j] >= INF) continue;      /* k cannot reach j */
                relaxTests++;
                through = dist[i][k] + dist[k][j];
                if (through < NEG_LIMIT) through = NEG_LIMIT;
                if (through < dist[i][j]) {
                    dist[i][j] = through;
                    nxt[i][j]  = nxt[i][k];
                    updates++;
                }
            }
        }
        /* Step 4: display matrices after chosen stages */
        if (traceMode == 1 || (traceMode == 2 && showStage[k]))
            printStage(k);
    }

    /* Step 6: negative diagonal entries indicate a negative cycle */
    hasNegCycle = 0;
    for (i = 0; i < n; i++)
        if (dist[i][i] < 0) hasNegCycle = 1;

    processed = 1;
}

/* A pair's cost is undefined (-infinity) if its path can pass a negative cycle. */
int isPairAffected(int i, int j)
{
    int k;
    for (k = 0; k < n; k++)
        if (dist[k][k] < 0 && dist[i][k] < INF && dist[k][j] < INF)
            return 1;
    return 0;
}

/* Reconstructs and prints the cheapest route from s to d using nxt[][]. */
void printRoute(int s, int d)
{
    int path[MAX + 1], len = 0, cur = s, h;

    path[len++] = cur;
    while (cur != d) {
        cur = nxt[cur][d];
        if (cur == -1 || len > n) {
            printf("  Route could not be reconstructed.\n");
            return;
        }
        path[len++] = cur;
    }

    printf("  Route : ");
    for (h = 0; h < len; h++)
        printf("%s%s", city[path[h]], (h < len - 1) ? " -> " : "\n");

    printf("  Legs  :\n");
    for (h = 0; h < len - 1; h++)
        printf("     %-14s -> %-14s : %lld\n",
               city[path[h]], city[path[h + 1]], cost[path[h]][path[h + 1]]);
    printf("  Cities on route: %d, roads used: %d\n", len, len - 1);
}

/* --------------------------- menu operations ---------------------------- */

void runAlgorithm(void)
{
    int mode, showStage[MAX] = {0}, count, ok;
    char buf[LINE_LEN], *tok, *end;
    long v;

    printf("\nTrace options:\n");
    printf("  1. No intermediate matrices\n");
    printf("  2. Show matrix after every stage k\n");
    printf("  3. Show matrix after selected stages only\n");
    mode = readInt("Choose (1-3): ", 1, 3) - 1;

    if (mode == 2) {
        printCities();
        while (1) {
            printf("Enter stage numbers to display (1-%d, space separated): ", n);
            readLine(buf, sizeof buf);
            memset(showStage, 0, sizeof showStage);
            count = 0;
            ok = 1;
            for (tok = strtok(buf, " \t,"); tok != NULL; tok = strtok(NULL, " \t,")) {
                v = strtol(tok, &end, 10);
                if (*end != '\0' || v < 1 || v > n) { ok = 0; break; }
                showStage[v - 1] = 1;
                count++;
            }
            if (ok && count > 0) break;
            printf("  Invalid list.\n");
        }
    }

    floydWarshall(mode, showStage);

    printf("\nFloyd-Warshall completed: %d stages, %lld relaxation checks, %lld updates.\n",
           n, relaxTests, updates);
    printMatrix(dist, "Final all-pairs distance matrix D(n):");
    if (hasNegCycle) {
        printf("\n*** WARNING: a negative cycle exists. Some costs are not finite. ***\n");
        printf("    See option 9 for details.\n");
    }
}

void queryLoop(void)
{
    int s, d, again;
    while (1) {
        printCities();
        s = readCity("Source city (number or name)      : ");
        d = readCity("Destination city (number or name) : ");

        printf("\n  %s -> %s\n", city[s], city[d]);
        if (isPairAffected(s, d)) {
            printf("  Cost  : -INFINITY (route can loop through a negative cycle).\n");
            printf("  No finite cheapest route exists.\n");
        } else if (dist[s][d] >= INF) {
            printf("  Cost  : UNREACHABLE (no route from %s to %s).\n", city[s], city[d]);
        } else if (s == d) {
            printf("  Cost  : 0 (source and destination are the same city).\n");
        } else {
            printf("  Cheapest travel cost: %lld\n", dist[s][d]);
            printRoute(s, d);
        }

        again = readInt("\nAnother query? (1 = Yes, 0 = No): ", 0, 1);
        if (!again) break;
    }
}

void listUnreachable(void)
{
    int i, j, count = 0;
    printf("\nUnreachable ordered pairs (source -> destination):\n");
    for (i = 0; i < n; i++)
        for (j = 0; j < n; j++)
            if (i != j && dist[i][j] >= INF) {
                printf("  %-14s -> %s\n", city[i], city[j]);
                count++;
            }
    if (count == 0) printf("  None. Every city can reach every other city.\n");
    else            printf("Total unreachable pairs: %d of %d\n", count, n * (n - 1));
}

void negativeCycleReport(void)
{
    int i, j, count = 0;
    printf("\nDiagonal check (dist[i][i] after completion):\n");
    for (i = 0; i < n; i++) {
        printf("  %-14s : ", city[i]);
        if (dist[i][i] < 0) printf("%lld  <-- lies on a negative cycle\n", dist[i][i]);
        else                printf("0\n");
    }
    if (!hasNegCycle) {
        printf("\nNo negative cycle detected. All finite distances are valid.\n");
        return;
    }
    printf("\n*** NEGATIVE CYCLE DETECTED ***\n");
    printf("Pairs whose cheapest cost is -INFINITY (undefined):\n");
    for (i = 0; i < n; i++)
        for (j = 0; j < n; j++)
            if (isPairAffected(i, j)) {
                printf("  %-14s -> %s\n", city[i], city[j]);
                count++;
            }
    printf("Total affected pairs: %d\n", count);
}

void analysisSummary(void)
{
    int i, j, edges = 0, negEdges = 0;
    for (i = 0; i < n; i++)
        for (j = 0; j < n; j++)
            if (i != j && cost[i][j] < INF) {
                edges++;
                if (cost[i][j] < 0) negEdges++;
            }

    printf("\n================ Analysis Summary ================\n");
    printf("Number of cities (n)            : %d\n", n);
    printf("Direct roads (edges)            : %d (negative: %d)\n", edges, negEdges);
    printf("Stages (intermediate cities k)  : %d\n", n);
    printf("Max i-k-j combinations (n^3)    : %d\n", n * n * n);
    printf("Relaxation checks performed     : %lld\n", relaxTests);
    printf("Successful updates              : %lld\n", updates);
    printf("Negative cycle                  : %s\n", hasNegCycle ? "YES" : "NO");
    printf("Time complexity                 : Theta(n^3)\n");
    printf("Space complexity                : Theta(n^2) (dist + next matrices)\n");
    printf("Recurrence:\n");
    printf("  D(k)[i][j] = min( D(k-1)[i][j], D(k-1)[i][k] + D(k-1)[k][j] )\n");
    printf("==================================================\n");
}

/* --------------------------------- main --------------------------------- */

void showMenu(void)
{
    printf("\n==================================================\n");
    printf("   INTERCITY ALL-PAIRS TRAVEL COST ANALYZER\n");
    printf("          (Floyd-Warshall Algorithm)\n");
    printf("==================================================\n");
    printf("  1. Enter cities and cost matrix\n");
    printf("  2. Load sample dataset\n");
    printf("  3. Display cities and input cost matrix\n");
    printf("  4. Run Floyd-Warshall algorithm\n");
    printf("  5. Display final distance matrix\n");
    printf("  6. Display next-hop (route) matrix\n");
    printf("  7. Query cheapest cost and route\n");
    printf("  8. List unreachable city pairs\n");
    printf("  9. Negative cycle report\n");
    printf(" 10. Analysis summary\n");
    printf("  0. Exit\n");
    printf("--------------------------------------------------\n");
}

int main(void)
{
    int choice;

    while (1) {
        showMenu();
        choice = readInt("Enter your choice: ", 0, 10);

        if (choice == 0) {
            printf("\nThank you. Exiting.\n");
            break;
        }
        if (choice >= 3 && !dataLoaded) {
            printf("\nNo graph available. Use option 1 or 2 first.\n");
            continue;
        }
        if (choice >= 5 && !processed) {
            printf("\nRun the Floyd-Warshall algorithm (option 4) first.\n");
            continue;
        }

        switch (choice) {
        case 1:  readGraph();                                        break;
        case 2:  loadSample();                                       break;
        case 3:  printCities();
                 printMatrix(cost, "Input cost matrix D(0):");       break;
        case 4:  runAlgorithm();                                     break;
        case 5:  printMatrix(dist, "Final all-pairs distance matrix D(n):");
                 if (hasNegCycle)
                     printf("WARNING: negative cycle present; see option 9.\n");
                 break;
        case 6:  printNextMatrix();                                  break;
        case 7:  queryLoop();                                        break;
        case 8:  listUnreachable();                                  break;
        case 9:  negativeCycleReport();                              break;
        case 10: analysisSummary();                                  break;
        }
    }
    return 0;
}
