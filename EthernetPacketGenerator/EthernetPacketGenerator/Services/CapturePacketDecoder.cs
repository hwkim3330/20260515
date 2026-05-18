using System.Text;
using EthernetPacketGenerator.Models;
using PacketDotNet;
using SharpPcap;

namespace EthernetPacketGenerator.Services;

public class CapturePacketDecoder
{
    public CaptureRow Decode(RawCapture raw, string interfaceName, int sequenceNo, DateTime captureStart)
    {
        double elapsed = (DateTime.Now - captureStart).TotalSeconds;
        string srcMac = string.Empty;
        string dstMac = string.Empty;
        string source = string.Empty;
        string destination = string.Empty;
        string protocol = "Ethernet";
        string info = string.Empty;
        int length = raw.Data.Length;
        var detail = new StringBuilder();

        detail.AppendLine($"Frame {sequenceNo}");
        detail.AppendLine($"  Interface: {interfaceName}");
        detail.AppendLine($"  Arrival Time: {DateTime.Now:yyyy-MM-dd HH:mm:ss.ffff}");
        detail.AppendLine($"  Time Since Start: {elapsed:F6} s");
        detail.AppendLine($"  Length: {length} bytes");

        try
        {
            var packet = Packet.ParsePacket(raw.LinkLayerType, raw.Data);
            if (packet is EthernetPacket eth)
            {
                srcMac = FormatMac(eth.SourceHardwareAddress?.ToString());
                dstMac = FormatMac(eth.DestinationHardwareAddress?.ToString());
                source = srcMac;
                destination = dstMac;

                detail.AppendLine();
                detail.AppendLine("Ethernet II");
                detail.AppendLine($"  Destination: {dstMac}");
                detail.AppendLine($"  Source: {srcMac}");
                detail.AppendLine($"  Type: 0x{(ushort)eth.Type:X4} ({eth.Type})");

                if (eth.PayloadPacket is ArpPacket arp)
                {
                    protocol = "ARP";
                    source = arp.SenderProtocolAddress?.ToString() ?? srcMac;
                    destination = arp.TargetProtocolAddress?.ToString() ?? dstMac;
                    info = $"Who has {destination}? Tell {source}";

                    detail.AppendLine();
                    detail.AppendLine("Address Resolution Protocol");
                    detail.AppendLine($"  Operation: {arp.Operation}");
                    detail.AppendLine($"  Sender MAC: {FormatMac(arp.SenderHardwareAddress?.ToString())}");
                    detail.AppendLine($"  Sender IP: {source}");
                    detail.AppendLine($"  Target MAC: {FormatMac(arp.TargetHardwareAddress?.ToString())}");
                    detail.AppendLine($"  Target IP: {destination}");
                }
                else if (eth.PayloadPacket is IPv4Packet ipv4)
                {
                    var srcIp = ipv4.SourceAddress?.ToString() ?? "?";
                    var dstIp = ipv4.DestinationAddress?.ToString() ?? "?";
                    protocol = "IPv4";
                    source = srcIp;
                    destination = dstIp;
                    info = $"{srcIp} -> {dstIp}";

                    detail.AppendLine();
                    detail.AppendLine("Internet Protocol Version 4");
                    detail.AppendLine($"  Source: {srcIp}");
                    detail.AppendLine($"  Destination: {dstIp}");
                    detail.AppendLine($"  Protocol: {ipv4.Protocol}");
                    detail.AppendLine($"  TTL: {ipv4.TimeToLive}");

                    if (ipv4.PayloadPacket is UdpPacket udp)
                    {
                        protocol = "UDP";
                        source = $"{srcIp}:{udp.SourcePort}";
                        destination = $"{dstIp}:{udp.DestinationPort}";
                        info = $"{source} -> {destination}  Len={udp.Length}";

                        detail.AppendLine();
                        detail.AppendLine("User Datagram Protocol");
                        detail.AppendLine($"  Source Port: {udp.SourcePort}");
                        detail.AppendLine($"  Destination Port: {udp.DestinationPort}");
                        detail.AppendLine($"  Length: {udp.Length}");
                    }
                    else if (ipv4.PayloadPacket is TcpPacket tcp)
                    {
                        protocol = "TCP";
                        source = $"{srcIp}:{tcp.SourcePort}";
                        destination = $"{dstIp}:{tcp.DestinationPort}";
                        var flags = TcpFlags(tcp);
                        info = $"{source} -> {destination}" + (flags.Length > 0 ? $" [{flags}]" : string.Empty);

                        detail.AppendLine();
                        detail.AppendLine("Transmission Control Protocol");
                        detail.AppendLine($"  Source Port: {tcp.SourcePort}");
                        detail.AppendLine($"  Destination Port: {tcp.DestinationPort}");
                        detail.AppendLine($"  Sequence Number: {tcp.SequenceNumber}");
                        detail.AppendLine($"  Acknowledgment Number: {tcp.AcknowledgmentNumber}");
                        detail.AppendLine($"  Flags: {flags}");
                    }
                    else if (ipv4.PayloadPacket is IcmpV4Packet icmp)
                    {
                        protocol = "ICMP";
                        info = $"{srcIp} -> {dstIp}  Type={icmp.TypeCode}";
                        detail.AppendLine();
                        detail.AppendLine("Internet Control Message Protocol");
                        detail.AppendLine($"  Type/Code: {icmp.TypeCode}");
                    }
                }
                else if (eth.PayloadPacket is IPv6Packet ipv6)
                {
                    protocol = "IPv6";
                    source = ipv6.SourceAddress?.ToString() ?? srcMac;
                    destination = ipv6.DestinationAddress?.ToString() ?? dstMac;
                    info = $"{source} -> {destination}";

                    detail.AppendLine();
                    detail.AppendLine("Internet Protocol Version 6");
                    detail.AppendLine($"  Source: {source}");
                    detail.AppendLine($"  Destination: {destination}");
                    detail.AppendLine($"  Next Header: {ipv6.NextHeader}");
                    detail.AppendLine($"  Hop Limit: {ipv6.HopLimit}");
                }
            }
        }
        catch (Exception ex)
        {
            info = $"Decode failed: {ex.Message}";
            detail.AppendLine();
            detail.AppendLine(info);
        }

        return new CaptureRow
        {
            No = sequenceNo,
            Time = elapsed.ToString("F6"),
            InterfaceName = interfaceName,
            SrcMac = srcMac,
            DstMac = dstMac,
            Source = string.IsNullOrEmpty(source) ? srcMac : source,
            Destination = string.IsNullOrEmpty(destination) ? dstMac : destination,
            Protocol = protocol,
            Length = length,
            Info = info,
            DetailText = detail.ToString(),
            HexDump = BuildHexDump(raw.Data),
            RawData = raw.Data.ToArray()
        };
    }

    public static string BuildHexDump(byte[] data)
    {
        var sb = new StringBuilder();
        for (int offset = 0; offset < data.Length; offset += 16)
        {
            var len = Math.Min(16, data.Length - offset);
            var hex = new StringBuilder();
            var ascii = new StringBuilder();

            for (int i = 0; i < 16; i++)
            {
                if (i < len)
                {
                    var b = data[offset + i];
                    hex.Append($"{b:X2} ");
                    ascii.Append(b >= 32 && b <= 126 ? (char)b : '.');
                }
                else
                {
                    hex.Append("   ");
                    ascii.Append(' ');
                }
            }

            sb.AppendLine($"{offset:X4}  {hex} {ascii}");
        }
        return sb.ToString();
    }

    private static string FormatMac(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;
        var hex = value.Replace(":", "").Replace("-", "").ToUpperInvariant();
        return hex.Length == 12
            ? string.Join(":", Enumerable.Range(0, 6).Select(i => hex.Substring(i * 2, 2)))
            : value;
    }

    private static string TcpFlags(TcpPacket tcp)
    {
        var flags = new List<string>();
        try
        {
            if (tcp.Synchronize) flags.Add("SYN");
            if (tcp.Acknowledgment) flags.Add("ACK");
            if (tcp.Finished) flags.Add("FIN");
            if (tcp.Reset) flags.Add("RST");
            if (tcp.Push) flags.Add("PSH");
            if (tcp.Urgent) flags.Add("URG");
        }
        catch { }
        return string.Join(", ", flags);
    }
}
