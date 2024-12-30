/**
 * https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html
 */
export interface EmbeddedMetricFormat {
  _aws: {
    CloudWatchMetrics: {
      Namespace: string;
      // biome-ignore lint/suspicious/noExplicitAny: <explanation>
      Dimensions: any[];
      Metrics: {
        Name: string;
        Unit?:
          | "Seconds"
          | "Microseconds"
          | "Milliseconds"
          | "Bytes"
          | "Kilobytes"
          | "Megabytes"
          | "Gigabytes"
          | "Terabytes"
          | "Bits"
          | "Kilobits"
          | "Megabits"
          | "Gigabits"
          | "Terabits"
          | "Percent"
          | "Count"
          | "Bytes/Second"
          | "Kilobytes/Second"
          | "Megabytes/Second"
          | "Gigabytes/Second"
          | "Terabytes/Second"
          | "Bits/Second"
          | "Kilobits/Second"
          | "Megabits/Second"
          | "Gigabits/Second"
          | "Terabits/Second"
          | "Count/Second"
          | "None";
      }[];
    }[];
    /**
     * milliseconds
     */
    Timestamp: number;
  };
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  [key: string]: any;
}
