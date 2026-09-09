<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useProducts } from '@/composables/useProducts';
import { useStoreSwitchEffect } from '@/composables/useStoreSwitchEffect';
import type {
  SaleOrderBreakdown,
  SaleOrderCustomerInsights,
  SaleOrderDateRange,
  SaleOrderSummary,
  SaleOrderTimeseriesPeriod,
  SaleOrderTimeseriesPoint,
} from '@/types/sales';
import { Logger } from '@/services/logger';
import { buildErrorContext, type ApplicationError } from '@/types/errors';
import { salesService } from '@/services/sales.service';
import { downloadCsv } from '@/utils/csv';
import { formatBRL } from '@/utils/formatters';

import StatsGrid from '@/components/dashboard/stats/StatsGrid.vue';
import SalesAnalyticsSection from '@/components/dashboard/stats/SalesAnalyticsSection.vue';
import StockAlertDrawer from '@/components/dashboard/stats/StockAlertDrawer.vue';

const {
  loading: productsLoading,
  inventoryStats,
  outOfStockProducts,
  lowStockProducts,
  fetchData,
} = useProducts();

const isStockAlertDrawerOpen = ref(false);

const salesSummary = ref<SaleOrderSummary | null>(null);
const isSalesSummaryLoading = ref(false);

const salesAnalyticsPeriod = ref<SaleOrderTimeseriesPeriod | 'custom'>('30d');
const salesAnalyticsCustomRange = ref<SaleOrderDateRange | null>(null);
const salesAnalyticsSummary = ref<SaleOrderSummary | null>(null);
const salesTimeseries = ref<SaleOrderTimeseriesPoint[]>([]);
const salesBreakdown = ref<SaleOrderBreakdown | null>(null);
const salesCustomerInsights = ref<SaleOrderCustomerInsights | null>(null);
const salesAnalyticsUpdatedAt = ref<Date | null>(null);
const isSalesAnalyticsLoading = ref(false);
const salesAnalyticsError = ref<string | null>(null);

const salesRevenueDisplay = ref(formatBRL(0));
const salesRevenueComparison = ref<number | null>(null);
// Online-sales foundation: the confirmed-vs-pending split shown under the
// volume number so "Vendas (30 dias)" is never mistaken for money received.
const salesRevenueSubtitle = ref<string | null>(null);

function buildRevenueSubtitle(summary: SaleOrderSummary): string {
  const parts = [`${formatBRL(summary.paid_revenue_total)} recebido`];
  if (Number(summary.pending_payment_total) > 0) {
    parts.push(`${formatBRL(summary.pending_payment_total)} pendente`);
  }
  if (Number(summary.refund_pending_total) > 0) {
    parts.push(`${formatBRL(summary.refund_pending_total)} a reembolsar`);
  }
  return parts.join(' · ');
}

const fetchSalesSummary = async (): Promise<void> => {
  isSalesSummaryLoading.value = true;

  try {
    salesSummary.value = await salesService.summary('30d');
    salesRevenueDisplay.value = formatBRL(salesSummary.value.revenue_total);
    salesRevenueSubtitle.value = buildRevenueSubtitle(salesSummary.value);
    const comparison = salesSummary.value.comparison_previous_period;
    salesRevenueComparison.value = comparison === null ? null : Number(comparison);
  } catch (error: unknown) {
    Logger.warn('Failed to fetch dashboard sales summary', buildErrorContext(error as ApplicationError));
    salesSummary.value = null;
    salesRevenueSubtitle.value = null;
  } finally {
    isSalesSummaryLoading.value = false;
  }
};

const resolveSalesAnalyticsQuery = (): SaleOrderTimeseriesPeriod | SaleOrderDateRange | null => {
  if (salesAnalyticsPeriod.value === 'custom') {
    return salesAnalyticsCustomRange.value;
  }
  return salesAnalyticsPeriod.value;
};

const fetchSalesAnalytics = async (
  query: SaleOrderTimeseriesPeriod | SaleOrderDateRange
): Promise<void> => {
  isSalesAnalyticsLoading.value = true;
  salesAnalyticsError.value = null;

  try {
    const [summaryResult, timeseriesResult, breakdownResult, customerInsightsResult] = await Promise.all([
      salesService.summary(query),
      salesService.timeseries(query),
      salesService.breakdown(query),
      salesService.customers(query),
    ]);
    salesAnalyticsSummary.value = summaryResult;
    salesTimeseries.value = timeseriesResult;
    salesBreakdown.value = breakdownResult;
    salesCustomerInsights.value = customerInsightsResult;
    salesAnalyticsUpdatedAt.value = new Date();
  } catch (error: unknown) {
    Logger.warn('Failed to fetch dashboard sales analytics', buildErrorContext(error as ApplicationError));
    salesAnalyticsError.value = 'Nao foi possivel carregar a analise de vendas agora.';
  } finally {
    isSalesAnalyticsLoading.value = false;
  }
};

const handleSalesAnalyticsPeriodChange = (period: string): void => {
  salesAnalyticsPeriod.value = period as SaleOrderTimeseriesPeriod | 'custom';

  if (period === 'custom') {
    salesAnalyticsCustomRange.value = null;
    return;
  }

  void fetchSalesAnalytics(salesAnalyticsPeriod.value as SaleOrderTimeseriesPeriod);
};

const handleSalesAnalyticsCustomRangeChange = (range: SaleOrderDateRange): void => {
  salesAnalyticsCustomRange.value = range;
  void fetchSalesAnalytics(range);
};

const handleExportSalesAnalyticsCsv = (): void => {
  const rows = salesTimeseries.value.map((point) => [point.date, point.revenue, point.orders_count]);
  downloadCsv(`vendas-${salesAnalyticsPeriod.value}.csv`, ['Data', 'Receita', 'Pedidos'], rows);
};

const handleRefreshSalesAnalytics = (): void => {
  const query = resolveSalesAnalyticsQuery();
  if (query === null) {
    return;
  }
  void fetchSalesAnalytics(query);
};

const refreshOverview = (): void => {
  void fetchData();
  void fetchSalesSummary();
  void fetchSalesAnalytics(salesAnalyticsPeriod.value as SaleOrderTimeseriesPeriod);
};

onMounted(refreshOverview);

// A loja ativa pode mudar pelo seletor no cabecalho enquanto esta pagina
// esta montada; sem isso os cards ficariam mostrando dados da loja anterior.
useStoreSwitchEffect(refreshOverview);
</script>

<template>
  <div class="space-y-16">
    <StatsGrid
      :stats="inventoryStats"
      :revenue="salesRevenueDisplay"
      :revenue-comparison="salesRevenueComparison"
      :revenue-subtitle="salesRevenueSubtitle"
      :is-loading="productsLoading || isSalesSummaryLoading"
      @open-stock-alerts="isStockAlertDrawerOpen = true"
    />

    <SalesAnalyticsSection
      :period="salesAnalyticsPeriod"
      :points="salesTimeseries"
      :breakdown="salesBreakdown"
      :customer-insights="salesCustomerInsights"
      :orders-count="salesAnalyticsSummary?.orders_count ?? 0"
      :average-ticket="salesAnalyticsSummary?.average_ticket ?? '0.00'"
      :comparison-same-period-last-year="salesAnalyticsSummary?.comparison_same_period_last_year ?? null"
      :custom-range="salesAnalyticsCustomRange"
      :is-loading="isSalesAnalyticsLoading"
      :error="salesAnalyticsError"
      :updated-at="salesAnalyticsUpdatedAt"
      @update:period="handleSalesAnalyticsPeriodChange"
      @update:custom-range="handleSalesAnalyticsCustomRangeChange"
      @refresh="handleRefreshSalesAnalytics"
      @export="handleExportSalesAnalyticsCsv"
    />

    <StockAlertDrawer
      :is-open="isStockAlertDrawerOpen"
      :out-of-stock-products="outOfStockProducts"
      :low-stock-products="lowStockProducts"
      :is-loading="productsLoading"
      @close="isStockAlertDrawerOpen = false"
    />
  </div>
</template>
