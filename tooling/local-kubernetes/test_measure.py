import unittest

from measure import kube_cpu_rates


class CpuRatesTest(unittest.TestCase):
    def test_independent_metric_intervals(self):
        first = {'pod_cpu': {'pod': {'seconds': 10, 'at': 100}},
                 'shared_node_cpu_core_seconds': 100, 'shared_node_cpu_at': 110}
        last = {'pod_cpu': {'pod': {'seconds': 70, 'at': 160}},
                'shared_node_cpu_core_seconds': 200, 'shared_node_cpu_at': 160}
        # Pod interval is 60 seconds; node interval is 50 seconds.
        self.assertEqual(kube_cpu_rates(first, last), (1, 2))

    def test_reset_is_rejected(self):
        first = {'pod_cpu': {'pod': {'seconds': 10, 'at': 100}},
                 'shared_node_cpu_core_seconds': 100, 'shared_node_cpu_at': 100}
        last = {'pod_cpu': {'pod': {'seconds': 1, 'at': 160}},
                'shared_node_cpu_core_seconds': 200, 'shared_node_cpu_at': 160}
        with self.assertRaisesRegex(RuntimeError, 'reset'):
            kube_cpu_rates(first, last)

    def test_replaced_pod_is_rejected(self):
        first = {'pod_cpu': {'old': {'seconds': 10, 'at': 100}}}
        last = {'pod_cpu': {'new': {'seconds': 10, 'at': 160}}}
        with self.assertRaisesRegex(RuntimeError, 'pods changed'):
            kube_cpu_rates(first, last)


if __name__ == '__main__':
    unittest.main()
