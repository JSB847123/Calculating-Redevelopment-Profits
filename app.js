const DEFAULTS = {
  equity: 5.5,
  loan: 2.5,
  autoPurchase: true,
  purchasePrice: 8,
  contribution: 3,
  rate: 5.5,
  years: 5,
  buyingCostRate: 3.5,
  sellingCost: 0.1,
  salePrice: 12,
  geminiModel: "gemini-3.5-flash",
};

const STORAGE_KEY = "rebuild-profit-calculator";
const STORAGE_UNIT = "eok";
const AI_KEY_STORAGE_KEY = "rebuild-profit-calculator-gemini-key";
const AI_SETTINGS_STORAGE_KEY = "rebuild-profit-calculator-ai-settings";
const GEMINI_INTERACTIONS_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";

const $ = (id) => document.getElementById(id);

const fields = {
  equity: $("equity"),
  loan: $("loan"),
  autoPurchase: $("auto-purchase"),
  purchasePrice: $("purchase-price"),
  contribution: $("contribution"),
  rate: $("rate"),
  years: $("years"),
  buyingCostRate: $("buying-cost-rate"),
  sellingCost: $("selling-cost-input"),
  salePrice: $("sale-price"),
  saleSlider: $("sale-slider"),
  geminiApiKey: $("gemini-api-key"),
  geminiModel: $("gemini-model"),
  rememberAiKey: $("remember-ai-key"),
};

const moneyFormatter = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 3,
});

const percentFormatter = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 1,
});

function readNumber(input, fallback = 0) {
  const value = Number(input.value);
  return Number.isFinite(value) ? value : fallback;
}

function getState() {
  const state = {
    equity: readNumber(fields.equity),
    loan: readNumber(fields.loan),
    autoPurchase: fields.autoPurchase.checked,
    purchasePrice: readNumber(fields.purchasePrice),
    contribution: readNumber(fields.contribution),
    rate: readNumber(fields.rate),
    years: readNumber(fields.years),
    buyingCostRate: readNumber(fields.buyingCostRate),
    sellingCost: readNumber(fields.sellingCost),
    salePrice: readNumber(fields.salePrice),
    geminiModel: fields.geminiModel.value.trim() || DEFAULTS.geminiModel,
  };

  if (state.autoPurchase) {
    state.purchasePrice = state.equity + state.loan;
  }

  return state;
}

function setState(state) {
  fields.equity.value = state.equity;
  fields.loan.value = state.loan;
  fields.autoPurchase.checked = state.autoPurchase;
  fields.purchasePrice.value = state.autoPurchase ? state.equity + state.loan : state.purchasePrice;
  fields.contribution.value = state.contribution;
  fields.rate.value = state.rate;
  fields.years.value = state.years;
  fields.buyingCostRate.value = state.buyingCostRate;
  fields.sellingCost.value = state.sellingCost;
  fields.salePrice.value = state.salePrice;
  fields.geminiModel.value = state.geminiModel || DEFAULTS.geminiModel;
  syncSlider(state);
  updatePurchaseMode();
}

function saveState(state) {
  const { geminiModel, ...calculatorState } = state;
  calculatorState.unit = STORAGE_UNIT;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(calculatorState));
  localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify({ geminiModel }));
}

function convertLegacyMoneyToEok(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number / 10000 : value;
}

function migrateSavedCalculatorState(saved) {
  if (saved.unit === STORAGE_UNIT) {
    return saved;
  }

  const moneyKeys = ["equity", "loan", "purchasePrice", "contribution", "salePrice"];
  const migrated = { ...saved };
  const hasLegacySellingCostRate = Object.prototype.hasOwnProperty.call(saved, "sellingCostRate");
  const looksLikeManwon = moneyKeys.some((key) => Number(saved[key]) >= 1000) || hasLegacySellingCostRate;

  if (!looksLikeManwon) {
    return migrated;
  }

  moneyKeys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(migrated, key)) {
      migrated[key] = convertLegacyMoneyToEok(migrated[key]);
    }
  });

  if (hasLegacySellingCostRate && !Object.prototype.hasOwnProperty.call(migrated, "sellingCost")) {
    const legacySalePrice = Number(saved.salePrice ?? DEFAULTS.salePrice * 10000);
    const legacyRate = Math.max(0, Number(saved.sellingCostRate) || 0);
    migrated.sellingCost = convertLegacyMoneyToEok(legacySalePrice * (legacyRate / 100));
  }

  delete migrated.sellingCostRate;
  migrated.unit = STORAGE_UNIT;
  return migrated;
}

function loadState() {
  const state = { ...DEFAULTS };

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && typeof saved === "object") {
      Object.assign(state, migrateSavedCalculatorState(saved));
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }

  try {
    const savedAiSettings = JSON.parse(localStorage.getItem(AI_SETTINGS_STORAGE_KEY));
    if (savedAiSettings && typeof savedAiSettings === "object") {
      Object.assign(state, savedAiSettings);
    }
  } catch {
    localStorage.removeItem(AI_SETTINGS_STORAGE_KEY);
  }

  return state;
}

function loadAiKey() {
  const savedKey = localStorage.getItem(AI_KEY_STORAGE_KEY) || "";
  fields.geminiApiKey.value = savedKey;
  fields.rememberAiKey.checked = Boolean(savedKey);
}

function formatMoney(eok) {
  const value = Number.isFinite(eok) ? eok : 0;
  const sign = value < 0 ? "-" : "";
  return `${sign}${moneyFormatter.format(Math.abs(value))}억원`;
}

function formatPercent(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${percentFormatter.format(value)}%`;
}

function calculateSaleOutcome(state, salePrice) {
  const purchasePrice = Math.max(0, state.purchasePrice);
  const loan = Math.max(0, state.loan);
  const neededEquity = Math.max(0, purchasePrice - loan);
  const buyingCost = purchasePrice * (Math.max(0, state.buyingCostRate) / 100);
  const sellingCost = Math.max(0, state.sellingCost);
  const totalInterest = loan * (Math.max(0, state.rate) / 100) * Math.max(0, state.years);
  const contribution = Math.max(0, state.contribution);
  const totalCashInvested = neededEquity + contribution + buyingCost + totalInterest;
  const netSaleProceeds = salePrice - sellingCost - loan;
  const profit = netSaleProceeds - totalCashInvested;

  return {
    purchasePrice,
    loan,
    neededEquity,
    contribution,
    buyingCost,
    sellingCost,
    totalInterest,
    totalCashInvested,
    netSaleProceeds,
    profit,
    cashRoe: totalCashInvested > 0 ? (profit / totalCashInvested) * 100 : 0,
    assetRoe: state.equity > 0 ? (profit / state.equity) * 100 : 0,
    monthlyInterest: loan * (Math.max(0, state.rate) / 100) / 12,
  };
}

function findBreakEvenPrice(state) {
  let low = 0;
  let high = Math.max(1, state.purchasePrice + state.contribution + state.loan + state.sellingCost + 10);

  while (calculateSaleOutcome(state, high).profit < 0 && high < 100000) {
    high *= 1.7;
  }

  for (let i = 0; i < 80; i += 1) {
    const mid = (low + high) / 2;
    if (calculateSaleOutcome(state, mid).profit >= 0) {
      high = mid;
    } else {
      low = mid;
    }
  }

  return high;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function setText(id, text) {
  $(id).textContent = text;
}

function setProfitClass(element, value) {
  element.classList.toggle("profit-good", value >= 0);
  element.classList.toggle("profit-bad", value < 0);
}

function updatePurchaseMode() {
  const state = getState();
  fields.purchasePrice.disabled = state.autoPurchase;
  if (state.autoPurchase) {
    fields.purchasePrice.value = state.purchasePrice;
  }
}

function syncSlider(state) {
  const salePrice = Math.max(0, state.salePrice);
  const min = Math.max(0, Math.floor(Math.min(state.purchasePrice * 0.5, salePrice * 0.7) * 10) / 10);
  const max = Math.max(1, Math.ceil(Math.max(state.purchasePrice * 2.1, salePrice * 1.2) * 10) / 10);
  fields.saleSlider.min = String(min);
  fields.saleSlider.max = String(max);
  fields.saleSlider.value = String(clamp(salePrice, min, max));
}

function updateRail(state, breakEven) {
  const values = [state.purchasePrice, breakEven, state.salePrice].filter(Number.isFinite);
  const min = Math.max(0, Math.min(...values) * 0.88);
  const max = Math.max(...values) * 1.08 || 1;
  const position = (value) => clamp(((value - min) / (max - min)) * 100, 4, 96);

  $("purchase-marker").style.setProperty("--pos", `${position(state.purchasePrice)}%`);
  $("breakeven-marker").style.setProperty("--pos", `${position(breakEven)}%`);
  $("expected-marker").style.setProperty("--pos", `${position(state.salePrice)}%`);

  setText("purchase-marker-value", formatMoney(state.purchasePrice));
  setText("breakeven-marker-value", formatMoney(breakEven));
  setText("expected-marker-value", formatMoney(state.salePrice));
}

function updateScenarios(state, breakEven) {
  const table = $("scenario-table");
  const steps = [-10, 0, 10, 20, 30, 40, 50, 70];
  const outcomes = steps.map((step) => {
    const salePrice = state.purchasePrice * (1 + step / 100);
    return { step, salePrice, ...calculateSaleOutcome(state, salePrice) };
  });
  const maxAbsProfit = Math.max(...outcomes.map((outcome) => Math.abs(outcome.profit)), 1);

  table.innerHTML = `
    <div class="scenario-row header">
      <span>상승률</span>
      <span>손익 위치</span>
      <span>매각가</span>
      <span>순이익</span>
    </div>
  `;

  outcomes.forEach((outcome) => {
    const row = document.createElement("div");
    const isGood = outcome.profit >= 0;
    const width = Math.max(4, (Math.abs(outcome.profit) / maxAbsProfit) * 100);
    const distanceToBreakEven = outcome.salePrice - breakEven;
    const label = distanceToBreakEven >= 0 ? "손익분기 이상" : "손익분기 미달";

    row.className = "scenario-row";
    row.innerHTML = `
      <span>${formatPercent(outcome.step)}</span>
      <div class="bar-track" title="${label}">
        <div class="bar-fill" style="--width: ${width}%; --bar-color: ${isGood ? "var(--accent)" : "var(--danger)"}"></div>
      </div>
      <span class="scenario-sale">${formatMoney(outcome.salePrice)}</span>
      <span class="scenario-profit ${isGood ? "good" : "bad"}">${formatMoney(outcome.profit)}</span>
    `;
    table.appendChild(row);
  });
}

function buildCalculationSnapshot() {
  const state = getState();
  const outcome = calculateSaleOutcome(state, state.salePrice);
  const breakEven = findBreakEvenPrice(state);
  const requiredReturn = state.purchasePrice > 0 ? ((breakEven - state.purchasePrice) / state.purchasePrice) * 100 : 0;
  const expectedReturn = state.purchasePrice > 0 ? ((state.salePrice - state.purchasePrice) / state.purchasePrice) * 100 : 0;
  const saleGap = state.salePrice - breakEven;
  const scenarios = [-10, 0, 10, 20, 30, 40, 50, 70].map((step) => {
    const salePrice = state.purchasePrice * (1 + step / 100);
    const scenarioOutcome = calculateSaleOutcome(state, salePrice);
    return {
      상승률: formatPercent(step),
      매각가: formatMoney(salePrice),
      순이익: formatMoney(scenarioOutcome.profit),
      투입자본수익률: formatPercent(scenarioOutcome.cashRoe),
    };
  });

  return {
    입력값: {
      보유자산: formatMoney(state.equity),
      대출금: formatMoney(state.loan),
      매수가: formatMoney(state.purchasePrice),
      분담금: formatMoney(state.contribution),
      연이자율: `${percentFormatter.format(state.rate)}%`,
      보유기간: `${percentFormatter.format(state.years)}년`,
      매수부대비용률: `${percentFormatter.format(state.buyingCostRate)}% (취득세·등기비)`,
      매도비용: `${formatMoney(state.sellingCost)} (중개보수 등)`,
      예상매각가: formatMoney(state.salePrice),
    },
    계산결과: {
      손익분기매각가: formatMoney(breakEven),
      필요상승률: formatPercent(requiredReturn),
      예상상승률: formatPercent(expectedReturn),
      예상순이익: formatMoney(outcome.profit),
      투입자본수익률: formatPercent(outcome.cashRoe),
      월이자: formatMoney(outcome.monthlyInterest),
      총이자: formatMoney(outcome.totalInterest),
      매수부대비용: formatMoney(outcome.buyingCost),
      매도비용: formatMoney(outcome.sellingCost),
      총투입현금: formatMoney(outcome.totalCashInvested),
      매각후순수령액: formatMoney(outcome.netSaleProceeds),
      손익분기대비예상가차이: formatMoney(saleGap),
      제외항목: "양도세",
    },
    상승률별손익: scenarios,
  };
}

function buildAiPrompt(snapshot) {
  return [
    "아래 재건축 투자 계산 결과를 한국어로 설명해줘.",
    "숫자는 앱 계산값을 기준으로만 해석하고, 단정적인 매수/매도 권유는 하지 마.",
    "결과는 5개 짧은 단락으로 작성해줘:",
    "1. 한 줄 결론",
    "2. 왜 그 손익분기점이 나오는지",
    "3. 가장 민감한 변수 3가지",
    "4. 예상 매각가 기준 위험/여유",
    "5. 실제 투자 전 확인할 것",
    "양도세는 계산에서 제외되어 있고, 대출 규제와 재건축 일정도 단순화되어 있으니 반드시 별도 확인이 필요하다고 짧게 말해줘.",
    "",
    JSON.stringify(snapshot, null, 2),
  ].join("\n");
}

function extractInteractionText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const chunks = [];
  (data.steps || []).forEach((step) => {
    (step.content || []).forEach((content) => {
      if (content.type === "text" && typeof content.text === "string") {
        chunks.push(content.text);
      }
    });
  });

  return chunks.join("\n\n").trim();
}

function setAiOutput(text, state = "idle") {
  const output = $("ai-output");
  output.textContent = text;
  output.classList.toggle("has-content", state === "content");
  output.classList.toggle("loading", state === "loading");
  output.classList.toggle("error", state === "error");
  $("copy-ai-button").disabled = state !== "content";
}

function markAiStale() {
  const output = $("ai-output");
  if (!output.classList.contains("has-content")) {
    return;
  }

  $("ai-status").textContent = "입력값이 바뀌었습니다. 최신 설명을 다시 생성할 수 있습니다.";
}

async function generateAiExplanation() {
  const apiKey = fields.geminiApiKey.value.trim();
  const model = fields.geminiModel.value.trim() || DEFAULTS.geminiModel;

  if (!apiKey) {
    setAiOutput("Gemini API 키를 입력한 뒤 다시 눌러주세요.", "error");
    $("ai-status").textContent = "API 키가 필요합니다.";
    return;
  }

  const snapshot = buildCalculationSnapshot();
  const button = $("generate-ai-button");
  button.disabled = true;
  button.textContent = "생성 중...";
  $("ai-status").textContent = `${model}로 계산 설명을 생성하는 중입니다.`;
  setAiOutput("계산값을 정리해서 Gemini에 보내고 있습니다.", "loading");

  try {
    if (fields.rememberAiKey.checked) {
      localStorage.setItem(AI_KEY_STORAGE_KEY, apiKey);
    } else {
      localStorage.removeItem(AI_KEY_STORAGE_KEY);
    }

    const response = await fetch(GEMINI_INTERACTIONS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        model,
        system_instruction:
          "너는 한국 부동산 재건축 투자 계산을 설명하는 보수적인 분석 보조자다. 투자 권유가 아니라 사용자가 입력한 숫자의 의미와 리스크만 설명한다.",
        input: buildAiPrompt(snapshot),
        generation_config: {
          temperature: 0.35,
          max_output_tokens: 1200,
          thinking_level: "low",
        },
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = data?.error?.message || `Gemini API 요청 실패 (${response.status})`;
      throw new Error(message);
    }

    const text = extractInteractionText(data);

    if (!text) {
      throw new Error("응답에서 텍스트를 찾지 못했습니다.");
    }

    setAiOutput(text, "content");
    $("ai-status").textContent = "현재 입력값 기준 설명입니다.";
  } catch (error) {
    setAiOutput(`AI 설명 생성에 실패했습니다.\n${error.message}`, "error");
    $("ai-status").textContent = "요청 실패";
  } finally {
    button.disabled = false;
    button.textContent = "AI 설명 생성";
  }
}

function update() {
  updatePurchaseMode();
  const state = getState();
  syncSlider(state);

  const outcome = calculateSaleOutcome(state, state.salePrice);
  const breakEven = findBreakEvenPrice(state);
  const requiredReturn = state.purchasePrice > 0 ? ((breakEven - state.purchasePrice) / state.purchasePrice) * 100 : 0;
  const expectedReturn = state.purchasePrice > 0 ? ((state.salePrice - state.purchasePrice) / state.purchasePrice) * 100 : 0;
  const neededRise = breakEven - state.purchasePrice;
  const saleGap = state.salePrice - breakEven;
  const fundingGap = state.purchasePrice - state.equity - state.loan;
  const ltv = state.purchasePrice > 0 ? (state.loan / state.purchasePrice) * 100 : 0;

  setText("break-even-price", formatMoney(breakEven));
  setText(
    "break-even-caption",
    `매수가 ${formatMoney(state.purchasePrice)}에서 최소 ${formatMoney(Math.max(0, neededRise))} 상승해야 비용을 모두 회수합니다.`
  );
  setText("required-return", formatPercent(requiredReturn));
  setText("expected-profit", formatMoney(outcome.profit));
  setProfitClass($("expected-profit"), outcome.profit);
  setText("cash-roe", formatPercent(outcome.cashRoe));
  setProfitClass($("cash-roe"), outcome.cashRoe);
  setText("monthly-interest", formatMoney(outcome.monthlyInterest));

  setText("needed-equity", formatMoney(outcome.neededEquity));
  setText("contribution-cost", formatMoney(outcome.contribution));
  setText("total-interest", formatMoney(outcome.totalInterest));
  setText("buying-cost", formatMoney(outcome.buyingCost));
  setText("total-cash", formatMoney(outcome.totalCashInvested));

  setText("gross-sale", formatMoney(state.salePrice));
  setText("selling-cost", formatMoney(outcome.sellingCost));
  setText("loan-payoff", formatMoney(outcome.loan));
  setText("net-sale-proceeds", formatMoney(outcome.netSaleProceeds));
  setText("sale-gap", `${saleGap >= 0 ? "손익분기 대비 +" : "손익분기 대비 "}${formatMoney(saleGap)}`);
  setText("funding-message", `LTV ${percentFormatter.format(ltv)}% · 예상 상승률 ${formatPercent(expectedReturn)}`);

  const status = $("deal-status");
  status.classList.toggle("good", outcome.profit >= 0);
  status.classList.toggle("bad", outcome.profit < 0);
  status.textContent = outcome.profit >= 0 ? "예상 수익 구간" : "예상 손실 구간";

  if (fundingGap > 0) {
    setText("funding-message", `자금 부족 ${formatMoney(fundingGap)} · LTV ${percentFormatter.format(ltv)}%`);
  } else if (fundingGap < 0 && !state.autoPurchase) {
    setText("funding-message", `잔여 현금 ${formatMoney(Math.abs(fundingGap))} · LTV ${percentFormatter.format(ltv)}%`);
  }

  updateRail(state, breakEven);
  updateScenarios(state, breakEven);
  saveState(state);
}

function bindEvents() {
  Object.entries(fields).forEach(([key, field]) => {
    if (key === "saleSlider") {
      return;
    }
    field.addEventListener("input", () => {
      if (key === "equity" || key === "loan" || key === "autoPurchase") {
        updatePurchaseMode();
      }
      update();
      if (key !== "geminiApiKey" && key !== "geminiModel" && key !== "rememberAiKey") {
        markAiStale();
      }
    });
  });

  fields.saleSlider.addEventListener("input", () => {
    fields.salePrice.value = fields.saleSlider.value;
    update();
    markAiStale();
  });

  $("reset-button").addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(AI_SETTINGS_STORAGE_KEY);
    setState(DEFAULTS);
    update();
    markAiStale();
  });

  $("generate-ai-button").addEventListener("click", generateAiExplanation);

  $("clear-ai-key-button").addEventListener("click", () => {
    fields.geminiApiKey.value = "";
    fields.rememberAiKey.checked = false;
    localStorage.removeItem(AI_KEY_STORAGE_KEY);
    $("ai-status").textContent = "저장된 API 키를 지웠습니다.";
  });

  $("copy-ai-button").addEventListener("click", async () => {
    const text = $("ai-output").textContent.trim();
    if (!text) {
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      $("ai-status").textContent = "AI 설명을 복사했습니다.";
    } catch {
      $("ai-status").textContent = "복사 권한을 사용할 수 없습니다.";
    }
  });
}

setState(loadState());
loadAiKey();
bindEvents();
update();
