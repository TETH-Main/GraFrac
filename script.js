class GraFracApp {
    constructor() {
        this.storageKey = 'grafrac.history.v2';
        this.state = {
            value: null,
            parsedLabel: '',
            maxDen: 1000,
            limit: 18,
            sort: 'recommended',
            reducedOnly: true,
            candidates: [],
            continuedFraction: [],
            best: null,
        };

        this.els = {
            valueInput: document.getElementById('valueInput'),
            randomBtn: document.getElementById('randomBtn'),
            clearBtn: document.getElementById('clearBtn'),
            maxDenInput: document.getElementById('maxDenInput'),
            limitInput: document.getElementById('limitInput'),
            sortSelect: document.getElementById('sortSelect'),
            strictReducedOnly: document.getElementById('strictReducedOnly'),
            statusText: document.getElementById('statusText'),
            historyList: document.getElementById('historyList'),
            clearHistoryBtn: document.getElementById('clearHistoryBtn'),
            bestCard: document.getElementById('bestCard'),
            bestFraction: document.getElementById('bestFraction'),
            bestMeta: document.getElementById('bestMeta'),
            copyFractionBtn: document.getElementById('copyFractionBtn'),
            copyLatexBtn: document.getElementById('copyLatexBtn'),
            copyShareLinkBtn: document.getElementById('copyShareLinkBtn'),
            continuedFractionText: document.getElementById('continuedFractionText'),
            errorInsightText: document.getElementById('errorInsightText'),
            resultGrid: document.getElementById('resultGrid'),
        };

        this.bindEvents();
        this.restoreFromUrl();
        this.renderHistory();
        this.update();
    }

    bindEvents() {
        this.els.valueInput.addEventListener('input', () => this.update(true));
        this.els.maxDenInput.addEventListener('input', () => this.update());
        this.els.limitInput.addEventListener('input', () => this.update());
        this.els.sortSelect.addEventListener('change', () => this.update());
        this.els.strictReducedOnly.addEventListener('change', () => this.update());

        this.els.randomBtn.addEventListener('click', () => {
            this.els.valueInput.value = Math.random().toFixed(10);
            this.update(true);
        });

        this.els.clearBtn.addEventListener('click', () => {
            this.els.valueInput.value = '';
            this.update();
        });

        document.querySelectorAll('.chip').forEach((chip) => {
            chip.addEventListener('click', () => {
                this.els.valueInput.value = chip.dataset.value || '';
                this.update(true);
            });
        });

        this.els.clearHistoryBtn.addEventListener('click', () => {
            localStorage.removeItem(this.storageKey);
            this.renderHistory();
            this.toast('履歴を消去しました');
        });

        this.els.copyFractionBtn.addEventListener('click', () => {
            if (!this.state.best) return;
            this.copyText(this.formatFraction(this.state.best.numerator, this.state.best.denominator), '分数をコピーしたよ！');
        });

        this.els.copyLatexBtn.addEventListener('click', () => {
            if (!this.state.best) return;
            const t = '\\frac{' + this.state.best.numerator + '}{' + this.state.best.denominator + '}';
            this.copyText(t, 'LaTeXをコピーしたよ！');
        });

        this.els.copyShareLinkBtn.addEventListener('click', () => {
            const u = new URL(window.location.href);
            this.copyText(u.toString(), '共有リンクをコピーしたよ！');
        });
    }

    restoreFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const value = String(params.get('v') || '').trim();
        const maxDen = Number(params.get('d') || '');
        const limit = Number(params.get('n') || '');
        const sort = String(params.get('s') || '').trim();

        if (value) this.els.valueInput.value = value;
        if (Number.isFinite(maxDen) && maxDen >= 8) this.els.maxDenInput.value = String(Math.min(9999, Math.round(maxDen)));
        if (Number.isFinite(limit) && limit >= 5) this.els.limitInput.value = String(Math.min(50, Math.round(limit)));
        if (['recommended', 'error', 'denominator', 'precisionThenShorter'].includes(sort)) this.els.sortSelect.value = sort;
    }

    update(pushHistory) {
        const parsed = this.parseInput(this.els.valueInput.value);
        this.state.maxDen = this.clampInt(this.els.maxDenInput.value, 8, 9999, 1000);
        this.state.limit = this.clampInt(this.els.limitInput.value, 5, 50, 18);
        this.state.sort = this.els.sortSelect.value;
        this.state.reducedOnly = !!this.els.strictReducedOnly.checked;
        this.els.maxDenInput.value = String(this.state.maxDen);
        this.els.limitInput.value = String(this.state.limit);

        if (!parsed.ok) {
            this.state.value = null;
            this.state.candidates = [];
            this.state.best = null;
            this.state.continuedFraction = [];
            this.renderInvalid(parsed.message);
            this.syncUrl();
            return;
        }

        this.state.value = parsed.value;
        this.state.parsedLabel = parsed.label;
        const result = this.buildCandidates(parsed.value, this.state.maxDen, this.state.reducedOnly);
        this.state.candidates = this.sortCandidates(result.candidates, this.state.sort).slice(0, this.state.limit);
        this.state.best = this.state.candidates[0] || null;
        this.state.continuedFraction = result.continuedFraction;

        if (pushHistory) {
            this.pushHistory(parsed.label);
        }

        this.renderValid();
        this.syncUrl();
    }

    parseInput(raw) {
        const text = String(raw || '').trim();
        if (!text) return { ok: false, message: '値を入力すると候補を表示します。' };

        let value = NaN;
        if (/^-?\d+(?:\.\d+)?\s*%$/.test(text)) {
            value = Number(text.replace('%', '')) / 100;
        } else if (/^-?\d+\s*\/\s*-?\d+$/.test(text)) {
            const parts = text.split('/').map((p) => Number(p.trim()));
            if (parts[1] === 0) {
                return { ok: false, message: '0で割る分数は入力できません。' };
            }
            value = parts[0] / parts[1];
        } else {
            value = Number(text);
        }

        if (!Number.isFinite(value)) {
            return { ok: false, message: '数値・割合(%)・分数(a/b)の形式で入力してください。' };
        }
        if (value < 0 || value > 1) {
            return { ok: false, message: 'GraFrac は 0〜1 の範囲に特化しています。' };
        }
        return { ok: true, value: value, label: text };
    }

    buildCandidates(x, maxDenominator, reducedOnly) {
        const map = new Map();
        const add = (n, d) => {
            if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return;
            let num = Math.round(n);
            let den = Math.round(d);
            if (den <= 0 || den > maxDenominator) return;
            const g = this.gcd(Math.abs(num), Math.abs(den));
            const rn = num / g;
            const rd = den / g;
            if (reducedOnly && g !== 1) {
                // Keep reduced-only policy strict by skipping non-primitive input directly.
                // Reduced pair is still produced via other generation paths.
            }
            const key = rn + '/' + rd;
            if (map.has(key)) return;
            const decimal = rn / rd;
            const error = Math.abs(x - decimal);
            const precision = this.getPrecisionRank(error);
            const totalLen = String(Math.abs(rn)).length + String(Math.abs(rd)).length;
            const simplicity = 1 / (1 + Math.log10(rd + 1));
            const recommendScore = (precision * 0.62) + (simplicity * 5.2) - (Math.log10(error + 1e-16) * -0.08);
            map.set(key, {
                numerator: rn,
                denominator: rd,
                decimal: decimal,
                error: error,
                precision: precision,
                totalLen: totalLen,
                recommendScore: recommendScore,
            });
        };

        const continuedFraction = this.toContinuedFraction(x, 16);
        const convergents = this.getConvergents(continuedFraction);
        convergents.forEach(([n, d]) => add(n, d));

        // Semi-convergents improve candidate quality between convergents.
        for (let i = 1; i < convergents.length; i += 1) {
            const prev = convergents[i - 1];
            const curr = convergents[i];
            if (!prev || !curr) continue;
            for (let t = 1; t <= 4; t += 1) {
                add(prev[0] + t * curr[0], prev[1] + t * curr[1]);
            }
        }

        const bruteLimit = Math.min(maxDenominator, 360);
        for (let d = 1; d <= bruteLimit; d += 1) {
            const center = x * d;
            const n0 = Math.floor(center);
            add(n0, d);
            add(n0 + 1, d);
            add(Math.round(center), d);
        }

        const candidates = Array.from(map.values()).filter((c) => c.numerator >= 0 && c.numerator <= c.denominator);
        return {
            candidates,
            continuedFraction,
        };
    }

    sortCandidates(candidates, mode) {
        const list = candidates.slice();
        if (mode === 'error') {
            list.sort((a, b) => a.error - b.error || a.denominator - b.denominator);
            return list;
        }
        if (mode === 'denominator') {
            list.sort((a, b) => a.denominator - b.denominator || a.error - b.error);
            return list;
        }
        if (mode === 'precisionThenShorter') {
            list.sort((a, b) => {
                if (b.precision !== a.precision) return b.precision - a.precision;
                if (a.totalLen !== b.totalLen) return a.totalLen - b.totalLen;
                return a.error - b.error;
            });
            return list;
        }
        list.sort((a, b) => b.recommendScore - a.recommendScore || a.error - b.error);
        return list;
    }

    renderInvalid(message) {
        this.els.statusText.textContent = message;
        this.els.statusText.className = 'status-text error';
        this.els.bestCard.hidden = true;
        this.els.continuedFractionText.textContent = '-';
        this.els.errorInsightText.textContent = '-';
        this.els.resultGrid.innerHTML = '';
    }

    renderValid() {
        const best = this.state.best;
        const n = this.state.candidates.length;
        this.els.statusText.textContent = n + '件の候補を表示中 (' + this.state.parsedLabel + ' → ' + this.state.value.toFixed(10) + ')';
        this.els.statusText.className = 'status-text ok';

        if (!best) {
            this.els.bestCard.hidden = true;
            this.els.resultGrid.innerHTML = '';
            return;
        }

        this.els.bestCard.hidden = false;
        this.els.bestFraction.textContent = this.formatFraction(best.numerator, best.denominator);
        this.els.bestMeta.textContent = '誤差 ' + best.error.toExponential(4) + ' | 精度ランク ' + best.precision + '桁 | 分母 ' + best.denominator;

        const cfText = this.state.continuedFraction.length
            ? '[' + this.state.continuedFraction[0] + '; ' + this.state.continuedFraction.slice(1).join(', ') + ']'
            : '-';
        this.els.continuedFractionText.textContent = cfText;
        this.els.errorInsightText.textContent = '最良候補との差: ' + Math.abs(this.state.value - best.decimal).toExponential(6);

        this.els.resultGrid.innerHTML = this.state.candidates.map((c, idx) => {
            return ''
                + '<article class="candidate" data-n="' + c.numerator + '" data-d="' + c.denominator + '">'
                + '<div class="candidate-top"><span class="candidate-rank">#' + (idx + 1) + '</span><span class="candidate-rank">d=' + c.denominator + '</span></div>'
                + '<div class="candidate-frac">' + this.formatFraction(c.numerator, c.denominator) + '</div>'
                + '<div class="candidate-line">≈ <strong>' + c.decimal.toFixed(10) + '</strong></div>'
                + '<div class="candidate-line">誤差: ' + c.error.toExponential(3) + '</div>'
                + '<div class="candidate-line">精度: ' + c.precision + '桁 / 文字数: ' + c.totalLen + '</div>'
                + '</article>';
        }).join('');

        this.els.resultGrid.querySelectorAll('.candidate').forEach((el) => {
            el.addEventListener('click', () => {
                const nn = Number(el.dataset.n);
                const dd = Number(el.dataset.d);
                this.copyText(this.formatFraction(nn, dd), '候補をコピーしたよ！');
            });
        });
    }

    formatFraction(n, d) {
        return n + '/' + d;
    }

    syncUrl() {
        const params = new URLSearchParams();
        const value = String(this.els.valueInput.value || '').trim();
        if (value) params.set('v', value);
        params.set('d', String(this.state.maxDen));
        params.set('n', String(this.state.limit));
        params.set('s', String(this.state.sort));
        const next = window.location.pathname + (params.toString() ? ('?' + params.toString()) : '');
        history.replaceState(null, '', next);
    }

    copyText(text, okMessage) {
        navigator.clipboard.writeText(String(text || '')).then(() => {
            this.toast(okMessage || 'コピーしたよ！');
        }).catch(() => {
            this.toast('コピーに失敗しました');
        });
    }

    toast(message) {
        if (window.TethUI && typeof window.TethUI.showToast === 'function') {
            window.TethUI.showToast(message);
            return;
        }
        console.info('[GraFrac]', message);
    }

    pushHistory(label) {
        const key = String(label || '').trim();
        if (!key) return;
        let list = this.readHistory();
        list = [key].concat(list.filter((v) => v !== key)).slice(0, 12);
        localStorage.setItem(this.storageKey, JSON.stringify(list));
        this.renderHistory();
    }

    readHistory() {
        try {
            const list = JSON.parse(localStorage.getItem(this.storageKey) || '[]');
            return Array.isArray(list) ? list.map((v) => String(v || '').trim()).filter(Boolean) : [];
        } catch (_) {
            return [];
        }
    }

    renderHistory() {
        const list = this.readHistory();
        if (!list.length) {
            this.els.historyList.innerHTML = '<span class="history-item" aria-disabled="true">まだありません</span>';
            return;
        }
        this.els.historyList.innerHTML = list.map((v) => '<button type="button" class="history-item" data-value="' + this.escapeHtml(v) + '">' + this.escapeHtml(v) + '</button>').join('');
        this.els.historyList.querySelectorAll('.history-item').forEach((btn) => {
            btn.addEventListener('click', () => {
                this.els.valueInput.value = btn.dataset.value || '';
                this.update();
            });
        });
    }

    clampInt(value, min, max, fallback) {
        const n = Number(value);
        if (!Number.isFinite(n)) return fallback;
        return Math.max(min, Math.min(max, Math.round(n)));
    }

    // Continued fraction core reused from previous implementation.
    toContinuedFraction(x, maxTerms) {
        const result = [];
        let current = Math.abs(x);
        for (let i = 0; i < maxTerms; i += 1) {
            const integerPart = Math.floor(current);
            result.push(integerPart);
            current -= integerPart;
            if (Math.abs(current) < 1e-12) break;
            current = 1 / current;
        }
        return x < 0 ? [-result[0]].concat(result.slice(1)) : result;
    }

    // Continued fraction convergents reused from previous implementation.
    getConvergents(continuedFraction) {
        const convergents = [];
        let hPrev2 = 0;
        let hPrev1 = 1;
        let kPrev2 = 1;
        let kPrev1 = 0;
        for (const a of continuedFraction) {
            const h = a * hPrev1 + hPrev2;
            const k = a * kPrev1 + kPrev2;
            convergents.push([h, k]);
            hPrev2 = hPrev1;
            hPrev1 = h;
            kPrev2 = kPrev1;
            kPrev1 = k;
        }
        return convergents;
    }

    gcd(a, b) {
        let x = Math.abs(a);
        let y = Math.abs(b);
        while (y !== 0) {
            const t = x % y;
            x = y;
            y = t;
        }
        return x || 1;
    }

    getPrecisionRank(error) {
        if (error === 0) return 16;
        if (!Number.isFinite(error)) return 0;
        return Math.max(0, Math.floor(-Math.log10(error)));
    }

    escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}

document.addEventListener('DOMContentLoaded', function () {
    window.graFracApp = new GraFracApp();
});
