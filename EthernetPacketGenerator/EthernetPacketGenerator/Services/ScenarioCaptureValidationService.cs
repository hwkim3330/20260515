using EthernetPacketGenerator.Models;

namespace EthernetPacketGenerator.Services;

public record ScenarioCaptureValidationSummary(int Pass, int Fail, int PacketCount);

public class ScenarioCaptureValidationService
{
    public ScenarioCaptureValidationSummary Validate(
        IEnumerable<TestScenarioStep> scenarioRows,
        IReadOnlyList<CaptureRow> packets,
        IReadOnlyList<string> selectedRxInterfaces)
    {
        var pass = 0;
        var fail = 0;
        string? activeExpected = null;
        var rxMap = BuildRxPortMap(selectedRxInterfaces);

        foreach (var row in scenarioRows.OrderBy(r => r.TC_ID).ThenBy(r => r.Test_Scenario_ID).ThenBy(r => r.Index))
        {
            row.Observed = string.Empty;
            row.Result = string.Empty;

            if (row.Action.Equals("FdbFlush", StringComparison.OrdinalIgnoreCase))
            {
                activeExpected = "0b1110";
                row.Observed = $"Expect flood: {string.Join(", ", ExpectedInterfaceTokens(activeExpected, rxMap).Select(ShortName))}";
                continue;
            }

            if (row.Action.Equals("FdbWrite", StringComparison.OrdinalIgnoreCase))
            {
                activeExpected = row.Expected;
                row.Observed = $"Expect {DescribeExpectedPorts(row.Expected)}";
                continue;
            }

            if (!row.Action.Equals("Packet", StringComparison.OrdinalIgnoreCase))
                continue;

            var mac = NormalizeMac(row.Value);
            var matches = packets
                .Where(p => p.DstMac.Equals(mac, StringComparison.OrdinalIgnoreCase))
                .ToList();

            var observedInterfaces = matches
                .Select(p => p.InterfaceName)
                .Where(i => !string.IsNullOrWhiteSpace(i))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(i => i)
                .ToList();

            var expected = ExpectedInterfaceTokens(activeExpected, rxMap);
            var monitored = rxMap.Values.ToList();
            var expectedHits = expected
                .Where(token => observedInterfaces.Any(i => InterfaceMatches(i, token)))
                .ToList();
            var unexpectedHits = observedInterfaces
                .Where(i => monitored.Any(token => InterfaceMatches(i, token)) &&
                            !expected.Any(token => InterfaceMatches(i, token)))
                .ToList();

            row.Observed = observedInterfaces.Count == 0
                ? $"No capture for {mac}"
                : string.Join(" | ", observedInterfaces.Select(ShortName));

            if (expected.Count == 0)
                row.Result = matches.Count > 0 ? "PASS" : "FAIL";
            else if (expectedHits.Count == expected.Count && unexpectedHits.Count == 0)
                row.Result = "PASS";
            else
                row.Result = "FAIL";

            if (row.Result == "PASS") pass++;
            else fail++;
        }

        return new ScenarioCaptureValidationSummary(pass, fail, packets.Count);
    }

    public static Dictionary<int, string> BuildRxPortMap(IReadOnlyList<string> selectedRxInterfaces)
    {
        var selected = selectedRxInterfaces
            .Where(n => !string.IsNullOrWhiteSpace(n))
            .ToList();

        if (selected.Count == 0)
            selected = new List<string> { "이더넷 10", "이더넷 8", "이더넷 5" };

        return new Dictionary<int, string>
        {
            [0b0010] = selected.ElementAtOrDefault(0) ?? "이더넷 10",
            [0b0100] = selected.ElementAtOrDefault(1) ?? "이더넷 8",
            [0b1000] = selected.ElementAtOrDefault(2) ?? "이더넷 5"
        };
    }

    public static string FormatRxPortMapping(IReadOnlyList<string> selectedRxInterfaces)
    {
        var rxMap = BuildRxPortMap(selectedRxInterfaces);
        return $"RX map from Capture checkboxes: 0b0010 -> {ShortName(rxMap[0b0010])}, 0b0100 -> {ShortName(rxMap[0b0100])}, 0b1000 -> {ShortName(rxMap[0b1000])}";
    }

    private static List<string> ExpectedInterfaceTokens(string? expected, Dictionary<int, string> rxMap)
    {
        var port = ParsePort(expected);
        var list = new List<string>();
        if ((port & 0b0010) != 0) list.Add(rxMap[0b0010]);
        if ((port & 0b0100) != 0) list.Add(rxMap[0b0100]);
        if ((port & 0b1000) != 0) list.Add(rxMap[0b1000]);
        return list;
    }

    private static string DescribeExpectedPorts(string? expected)
    {
        var port = ParsePort(expected);
        var parts = new List<string>();
        if ((port & 0b0010) != 0) parts.Add("RX1");
        if ((port & 0b0100) != 0) parts.Add("RX2");
        if ((port & 0b1000) != 0) parts.Add("RX3");
        return parts.Count == 0 ? "no monitored RX port" : string.Join(", ", parts);
    }

    private static int ParsePort(string? value)
    {
        var clean = (value ?? "").Trim();
        if (clean.StartsWith("0b", StringComparison.OrdinalIgnoreCase))
            return Convert.ToInt32(clean[2..], 2);
        return int.TryParse(clean, out var parsed) ? parsed : 0;
    }

    private static string NormalizeMac(string? value)
    {
        var mac = (value ?? "").Trim().Replace("-", ":").ToUpperInvariant();
        return string.IsNullOrWhiteSpace(mac) ? "C8:4D:44:25:2D:37" : mac;
    }

    private static bool InterfaceMatches(string observed, string expected)
    {
        if (observed.Equals(expected, StringComparison.OrdinalIgnoreCase)) return true;
        if (observed.Contains(expected, StringComparison.OrdinalIgnoreCase)) return true;
        if (expected.Contains(observed, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    private static string ShortName(string name)
    {
        if (name.Length <= 26) return name;
        var trimmed = name.Replace("\\Device\\NPF_", "", StringComparison.OrdinalIgnoreCase);
        return trimmed.Length <= 26 ? trimmed : trimmed[..26] + "...";
    }
}
