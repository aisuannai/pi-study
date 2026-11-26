import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";

const sales = [
  { region: "华东", product: "键盘", amount: 1200 },
  { region: "华南", product: "鼠标", amount: 800 },
  { region: "华东", product: "显示器", amount: 3200 },
];

export const querySalesTool = defineTool({
  name: "query_sales",
  label: "查询销售记录",
  description: "按地区查询示例销售记录。只读，不会修改数据。",
  parameters: Type.Object({
    region: Type.String({
      description: "地区名称，例如：华东",
    }),
    maxRows: Type.Optional(
      Type.Number({
        description: "最多返回几条，至少为 1",
        minimum: 1,
      }),
    ),
  }),
  async execute(_toolCallId, params, signal) {
    if (signal?.aborted) {
      return {
        content: [{ type: "text", text: "查询已取消。" }],
        details: { count: 0 },
        isError: true,
      };
    }

    const maxRows = Math.min(params.maxRows ?? 10, 20);
    const rows = sales
      .filter((row) => row.region === params.region)
      .slice(0, maxRows);

    if (rows.length === 0) {
      return {
        content: [{ type: "text", text: `没有找到 ${params.region} 的记录。` }],
        details: { count: 0 },
      };
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify(rows, null, 2),
      }],
      details: { count: rows.length },
    };
  },
});
